import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { isSettled, prepaymentRequired, settlementSelect } from '../common/settlement.js';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { prescriptionInclude } from '../prescriptions/prescriptions.controller.js';
import { queuePatientSelect } from '../visits/visits.controller.js';

const DispenseSchema = z.object({
  items: z
    .array(z.object({ itemId: z.uuid(), quantity: z.number().int().min(1) }))
    .min(1)
    .refine((items) => new Set(items.map((i) => i.itemId)).size === items.length, 'Each item may appear only once'),
});

const DrugSearchSchema = z.object({ q: z.string().trim().default('') });

/** Batches still usable today (expiry on or after the start of the clinic day). */
const usableFrom = () => dayRange(clinicDay()).start;

@Controller()
export class PharmacyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Usable (non-expired) stock per drug. */
  private async stockFor(tenantId: string, drugIds: string[]) {
    if (!drugIds.length) return new Map<string, number>();
    const rows = await this.prisma.client.stockBatch.groupBy({
      by: ['drugId'],
      where: { drugId: { in: drugIds }, drug: { tenantId }, quantity: { gt: 0 }, expiryDate: { gte: usableFrom() } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.drugId, r._sum.quantity ?? 0]));
  }

  @Get('drugs')
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST')
  async drugs(@CurrentUser() me: AuthUser, @Query(new ZodPipe(DrugSearchSchema)) { q }: z.infer<typeof DrugSearchSchema>) {
    const words = q.split(/\s+/).filter(Boolean);
    const drugs = await this.prisma.client.drug.findMany({
      where: {
        tenantId: me.tenantId,
        active: true,
        AND: words.map((w) => ({
          OR: [
            { genericName: { contains: w, mode: 'insensitive' as const } },
            { brandName: { contains: w, mode: 'insensitive' as const } },
            { drugClass: { contains: w, mode: 'insensitive' as const } },
          ],
        })),
      },
      orderBy: { genericName: 'asc' },
      take: 20,
    });
    const stock = await this.stockFor(me.tenantId, drugs.map((d) => d.id));
    return drugs.map((d) => ({ ...d, inStock: stock.get(d.id) ?? 0 }));
  }

  /** Prescriptions waiting at the pharmacy, oldest first, plus what was dispensed today. */
  @Get('pharmacy/queue')
  @Roles('ADMIN', 'PHARMACIST')
  async queue(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const include = {
      ...prescriptionInclude,
      visit: { select: { id: true, queueNumber: true, status: true, patient: { select: queuePatientSelect } } },
    };
    const [open, dispensedToday] = await Promise.all([
      db.prescription.findMany({
        where: { tenantId: me.tenantId, status: { in: ['PENDING', 'PARTIALLY_DISPENSED'] } },
        orderBy: { createdAt: 'asc' },
        include,
      }),
      db.prescription.findMany({
        where: { tenantId: me.tenantId, status: 'DISPENSED', dispensedAt: { gte: dayRange(clinicDay()).start } },
        orderBy: { dispensedAt: 'desc' },
        include,
      }),
    ]);
    const itemIds = open.flatMap((p) => p.items.map((i) => i.id));
    const [stock, paid, prepayment] = await Promise.all([
      this.stockFor(me.tenantId, [...new Set(open.flatMap((p) => p.items.map((i) => i.drugId)))]),
      this.paidQuantities(db, itemIds),
      prepaymentRequired(db, me.tenantId),
    ]);
    return {
      prepayment,
      open: open.map((p) => ({
        ...p,
        items: p.items.map((i) => ({
          ...i,
          inStock: stock.get(i.drugId) ?? 0,
          paidQty: Number(i.drug.sellPrice) > 0 ? (paid.get(i.id) ?? 0) : i.quantity,
        })),
      })),
      dispensedToday,
    };
  }

  /** Units per prescription item whose charges are settled (paid, or billed to credit/insurance). */
  private async paidQuantities(tx: Pick<Prisma.TransactionClient, 'charge'>, itemIds: string[]) {
    if (!itemIds.length) return new Map<string, number>();
    const charges = await tx.charge.findMany({
      where: { source: 'PHARMACY', sourceId: { in: itemIds } },
      select: { sourceId: true, quantity: true, ...settlementSelect },
    });
    const paid = new Map<string, number>();
    for (const c of charges) if (isSettled(c)) paid.set(c.sourceId!, (paid.get(c.sourceId!) ?? 0) + c.quantity);
    return paid;
  }

  /**
   * Pay-first step: prices the units the patient will take and sends them to the cashier as
   * charges. The pharmacist may bill fewer than prescribed (e.g. when stock is short).
   */
  @Post('prescriptions/:id/bill')
  @Roles('ADMIN', 'PHARMACIST')
  async bill(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(DispenseSchema)) body: z.infer<typeof DispenseSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Prescription not found');
    return this.prisma.client.$transaction(async (tx) => {
      const p = await tx.prescription.findFirst({ where: { id, tenantId: me.tenantId }, include: { items: { include: { drug: true } } } });
      if (!p) throw new NotFoundException('Prescription not found');
      if (p.status !== 'PENDING' && p.status !== 'PARTIALLY_DISPENSED') {
        throw new ConflictException(`This prescription is ${p.status.toLowerCase().replace('_', ' ')}`);
      }
      for (const req of body.items) {
        const item = p.items.find((i) => i.id === req.itemId);
        if (!item) throw new NotFoundException('Prescription item not found');
        // Atomic: never bill more units than were prescribed, even if two people click at once.
        const updated = await tx.$executeRaw`
          UPDATE "PrescriptionItem" SET "billedQty" = "billedQty" + ${req.quantity}
          WHERE "id" = ${item.id} AND "billedQty" + ${req.quantity} <= "quantity"`;
        if (updated !== 1) {
          throw new ConflictException(`Only ${item.quantity - item.billedQty} ${item.drug.unit} of ${item.drug.genericName} are left to bill`);
        }
        await tx.charge.create({ data: this.chargeFor(p.visitId, item, req.quantity) });
      }
      await this.audit.log(me, 'prescription.bill', 'Prescription', id, { items: body.items }, tx);
      return tx.prescription.findUniqueOrThrow({ where: { id }, include: prescriptionInclude });
    });
  }

  private chargeFor(
    visitId: string,
    item: { id: string; drug: { genericName: string; strength: string | null; form: string; sellPrice: Prisma.Decimal } },
    quantity: number,
  ) {
    return {
      visitId,
      source: 'PHARMACY' as const,
      sourceId: item.id,
      description: [item.drug.genericName, item.drug.strength, item.drug.form].filter(Boolean).join(' '),
      quantity,
      unitPrice: item.drug.sellPrice,
    };
  }

  /**
   * Dispenses items from the earliest-expiring usable batches (FEFO). All-or-nothing: if any
   * item is short of stock, nothing is dispensed. Each unit taken is recorded as a stock movement
   * and charged to the visit.
   */
  @Post('prescriptions/:id/dispense')
  @Roles('ADMIN', 'PHARMACIST')
  async dispense(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(DispenseSchema)) body: z.infer<typeof DispenseSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Prescription not found');
    const from = usableFrom();

    return this.prisma.client.$transaction(async (tx) => {
      // Lock the prescription so concurrent dispensing sees each other's dispensed quantities.
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Prescription" WHERE "id" = ${id} AND "tenantId" = ${me.tenantId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Prescription not found');
      const p = await tx.prescription.findUniqueOrThrow({ where: { id }, include: { items: { include: { drug: true } } } });
      if (p.status !== 'PENDING' && p.status !== 'PARTIALLY_DISPENSED') {
        throw new ConflictException(`This prescription is ${p.status.toLowerCase().replace('_', ' ')}`);
      }
      const prepay = await prepaymentRequired(tx, me.tenantId);
      const paid = prepay ? await this.paidQuantities(tx, p.items.map((i) => i.id)) : new Map<string, number>();

      for (const req of body.items) {
        const item = p.items.find((i) => i.id === req.itemId);
        if (!item) throw new NotFoundException('Prescription item not found');
        const remaining = item.quantity - item.dispensedQty;
        if (req.quantity > remaining) {
          throw new ConflictException(`Only ${remaining} ${item.drug.unit} of ${item.drug.genericName} remain to be dispensed`);
        }
        // Free drugs (price 0, e.g. programme supplies) never wait for the cashier.
        if (prepay && Number(item.drug.sellPrice) > 0) {
          const paidLeft = (paid.get(item.id) ?? 0) - item.dispensedQty;
          if (req.quantity > paidLeft) {
            throw new ConflictException(
              paidLeft > 0
                ? `Only ${paidLeft} ${item.drug.unit} of ${item.drug.genericName} have been paid for`
                : `${item.drug.genericName} has not been paid for yet; send the patient to the cashier`,
            );
          }
        }

        // Lock this drug's usable batches so concurrent dispensing can't oversell them.
        const batches = await tx.$queryRaw<{ id: string; quantity: number }[]>`
          SELECT "id", "quantity" FROM "StockBatch"
          WHERE "drugId" = ${item.drugId} AND "quantity" > 0 AND "expiryDate" >= ${from}
          ORDER BY "expiryDate" ASC, "receivedAt" ASC
          FOR UPDATE`;
        const available = batches.reduce((s, b) => s + b.quantity, 0);
        if (available < req.quantity) {
          throw new ConflictException(
            `Not enough ${item.drug.genericName} in stock: ${available} ${item.drug.unit} available, ${req.quantity} requested`,
          );
        }

        let left = req.quantity;
        for (const b of batches) {
          if (left === 0) break;
          const take = Math.min(left, b.quantity);
          await tx.stockBatch.update({ where: { id: b.id }, data: { quantity: { decrement: take } } });
          await tx.stockMovement.create({ data: { batchId: b.id, type: 'DISPENSE', quantity: -take, reference: item.id, userId: me.sub } });
          left -= take;
        }

        // Bill-at-the-end clinics: charge whatever is handed over beyond what was already billed.
        const unbilled = item.dispensedQty + req.quantity - item.billedQty;
        if (!prepay && unbilled > 0) {
          await tx.charge.create({ data: this.chargeFor(p.visitId, item, unbilled) });
        }
        await tx.prescriptionItem.update({
          where: { id: item.id },
          data: { dispensedQty: { increment: req.quantity }, ...(!prepay && unbilled > 0 && { billedQty: { increment: unbilled } }) },
        });
      }

      const items = await tx.prescriptionItem.findMany({ where: { prescriptionId: id } });
      const complete = items.every((i) => i.dispensedQty >= i.quantity);
      const updated = await tx.prescription.update({
        where: { id },
        data: complete ? { status: 'DISPENSED', dispensedAt: new Date() } : { status: 'PARTIALLY_DISPENSED' },
        include: prescriptionInclude,
      });

      // A visit waiting only on the pharmacy is finished once nothing is left to dispense.
      if (complete) {
        const visit = await tx.visit.findUniqueOrThrow({ where: { id: p.visitId } });
        const stillOpen = await tx.prescription.count({
          where: { visitId: p.visitId, status: { in: ['PENDING', 'PARTIALLY_DISPENSED'] } },
        });
        if (visit.status === 'AWAITING_PHARMACY' && stillOpen === 0) {
          await tx.visit.update({ where: { id: visit.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        }
      }

      await this.audit.log(me, 'prescription.dispense', 'Prescription', id, { items: body.items }, tx);
      return updated;
    });
  }
}

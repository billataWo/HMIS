import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { chargeTerms, isSettled, prepaymentRequired, settlementSelect } from '../common/settlement.js';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { allergyAlerts } from '../prescriptions/drug-safety.js';
import { dispensableWhere, storeMode } from '../inventory/stores.js';
import { prescriptionInclude } from '../prescriptions/prescriptions.controller.js';
import { OPEN_RX, pendingLabTests, queuePatientSelect } from '../visits/visits.controller.js';

const DispenseSchema = z.object({
  items: z
    .array(z.object({ itemId: z.uuid(), quantity: z.number().int().min(1) }))
    .min(1)
    .refine((items) => new Set(items.map((i) => i.itemId)).size === items.length, 'Each item may appear only once'),
});

const CloseSchema = z.object({ reason: z.string().trim().min(3, 'Say why the rest will not be collected').max(300) });

const DrugSearchSchema = z.object({ q: z.string().trim().default('') });

const SubstituteSchema = z.object({
  drugId: z.uuid(),
  reason: z.string().trim().min(3, 'Say why, e.g. prescribed brand out of stock').max(200),
});

const ReturnSchema = z.object({
  quantity: z.number().int().min(1),
  // Sealed and fit to sell again; otherwise the units are kept aside for destruction.
  restocked: z.boolean(),
  reason: z.string().trim().min(3, 'Say why the drugs came back').max(300),
});

/** Another brand of the same drug: same generic name, strength and form, ignoring case and spacing. */
const words = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const equivalent = (a: { genericName: string; strength: string | null; form: string }, b: { genericName: string; strength: string | null; form: string }) =>
  words(a.genericName) === words(b.genericName) && words(a.strength) === words(b.strength) && words(a.form) === words(b.form);

/** Batches still usable today (expiry on or after the start of the clinic day). */
const usableFrom = () => dayRange(clinicDay()).start;

@Controller()
export class PharmacyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Usable (non-expired) stock per drug. */
  /**
   * Usable stock per drug: what can be dispensed (the dispensary stores, when the clinic has
   * several) or, with `everywhere`, in every store.
   */
  private async stockFor(tenantId: string, drugIds: string[], everywhere = false) {
    if (!drugIds.length) return new Map<string, number>();
    const scope = everywhere ? {} : dispensableWhere(await storeMode(this.prisma.client, tenantId));
    const rows = await this.prisma.client.stockBatch.groupBy({
      by: ['drugId'],
      where: { drugId: { in: drugIds }, drug: { tenantId }, quantity: { gt: 0 }, expiryDate: { gte: usableFrom() }, ...scope },
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
      visit: { select: { id: true, queueNumber: true, status: true, kind: true, patient: { select: queuePatientSelect } } },
    };
    const [open, dispensedToday, returnsToday] = await Promise.all([
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
      db.drugReturn.findMany({
        where: { tenantId: me.tenantId, createdAt: { gte: dayRange(clinicDay()).start } },
        orderBy: { createdAt: 'desc' },
        include: {
          prescriptionItem: {
            select: {
              drug: { select: { genericName: true, strength: true, form: true, unit: true } },
              prescription: { select: { visit: { select: { patient: { select: { id: true, mrn: true, firstName: true, fatherName: true } } } } } },
            },
          },
        },
      }),
    ]);
    const itemIds = open.flatMap((p) => p.items.map((i) => i.id));
    const openDrugIds = [...new Set(open.flatMap((p) => p.items.map((i) => i.drugId)))];
    const [stock, everywhere, paid, prepayment] = await Promise.all([
      this.stockFor(me.tenantId, openDrugIds),
      this.stockFor(me.tenantId, openDrugIds, true),
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
          // In other stores (several stores): to transfer to the dispensary.
          elsewhere: (everywhere.get(i.drugId) ?? 0) - (stock.get(i.drugId) ?? 0),
          paidQty: Number(i.drug.sellPrice) > 0 ? (paid.get(i.id) ?? 0) : i.quantity,
        })),
      })),
      dispensedToday,
      returnsToday,
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
        await tx.charge.create({ data: await this.chargeFor(tx, p.visitId, item, req.quantity) });
      }
      await this.audit.log(me, 'prescription.bill', 'Prescription', id, { items: body.items }, tx);
      return tx.prescription.findUniqueOrThrow({ where: { id }, include: prescriptionInclude });
    });
  }

  /** A drug charge, at the visit's payer's tariff when it is billed to one. */
  private async chargeFor(
    tx: Prisma.TransactionClient,
    visitId: string,
    item: { id: string; drug: { id: string; genericName: string; strength: string | null; form: string; sellPrice: Prisma.Decimal } },
    quantity: number,
  ) {
    const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId }, select: { payerId: true } });
    return {
      visitId,
      source: 'PHARMACY' as const,
      sourceId: item.id,
      description: [item.drug.genericName, item.drug.strength, item.drug.form].filter(Boolean).join(' '),
      quantity,
      ...(await chargeTerms(tx, visit, 'DRUG', item.drug.id, item.drug.sellPrice)),
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
      const mode = await storeMode(tx, me.tenantId);
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
          // Paid units not handed over yet. Units brought back and refunded left the paid count, so
          // they come off the handed-over count too; returned units not refunded are refunded, not
          // given again, so they never count twice.
          const paidLeft = (paid.get(item.id) ?? 0) - (item.dispensedQty - item.refundedQty);
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
            AND (${!mode.multi} OR "storeId" = ANY(${mode.dispensaryIds}::text[]))
          ORDER BY "expiryDate" ASC, "receivedAt" ASC
          FOR UPDATE`;
        const available = batches.reduce((s, b) => s + b.quantity, 0);
        if (available < req.quantity) {
          throw new ConflictException(
            mode.multi
              ? `Not enough ${item.drug.genericName} in the dispensary: ${available} ${item.drug.unit} there, ${req.quantity} requested. Transfer more from another store first.`
              : `Not enough ${item.drug.genericName} in stock: ${available} ${item.drug.unit} available, ${req.quantity} requested`,
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
          await tx.charge.create({ data: await this.chargeFor(tx, p.visitId, item, unbilled) });
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

      if (complete) await this.finishPharmacyVisit(tx, p.visitId);

      await this.audit.log(me, 'prescription.dispense', 'Prescription', id, { items: body.items }, tx);
      return updated;
    });
  }

  /**
   * A visit waiting only on the pharmacy is finished once nothing is left to dispense, unless lab
   * results are still on their way to the doctor.
   */
  private async finishPharmacyVisit(tx: Prisma.TransactionClient, visitId: string) {
    const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
    if (visit.status !== 'AWAITING_PHARMACY') return;
    const stillOpen = await tx.prescription.count({ where: { visitId, status: { in: OPEN_RX } } });
    if (stillOpen === 0 && (await pendingLabTests(tx, visitId)).length === 0) {
      await tx.visit.update({ where: { id: visitId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    }
  }

  /**
   * Closes what is left of a prescription the patient won't collect (bought elsewhere, left).
   * Unpaid units that never reached an invoice are dropped from the cashier's list. Units billed on
   * an invoice but not handed over must first be removed from it (refunded) by an admin, so the
   * books always match what left the shelf.
   */
  @Post('prescriptions/:id/close')
  @Roles('ADMIN', 'PHARMACIST')
  async close(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(CloseSchema)) { reason }: z.infer<typeof CloseSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Prescription not found');
    return this.prisma.client.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Prescription" WHERE "id" = ${id} AND "tenantId" = ${me.tenantId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Prescription not found');
      const p = await tx.prescription.findUniqueOrThrow({ where: { id }, include: { items: { include: { drug: true } } } });
      if (p.status !== 'PENDING' && p.status !== 'PARTIALLY_DISPENSED') {
        throw new ConflictException(`This prescription is ${p.status.toLowerCase().replace('_', ' ')}`);
      }

      // With pay-first, drug charges only come from "send to cashier", so any not yet on an invoice
      // are for units still on the shelf.
      if (await prepaymentRequired(tx, me.tenantId)) {
        for (const item of p.items) {
          const loose = await tx.charge.findMany({ where: { source: 'PHARMACY', sourceId: item.id, invoiceId: null, voidedAt: null } });
          const qty = loose.reduce((s, c) => s + c.quantity, 0);
          if (!qty) continue;
          await tx.charge.deleteMany({ where: { id: { in: loose.map((c) => c.id) } } });
          await tx.prescriptionItem.update({ where: { id: item.id }, data: { billedQty: { decrement: qty } } });
          item.billedQty -= qty;
        }
      }
      for (const item of p.items) {
        const owed = item.billedQty - item.dispensedQty;
        if (owed > 0) {
          throw new ConflictException(
            `${owed} ${item.drug.unit} of ${item.drug.genericName} are on an invoice but were not handed over. Hand them over, or ask an admin to remove them from the invoice (refund) first.`,
          );
        }
      }

      const anyDispensed = p.items.some((i) => i.dispensedQty > 0);
      const updated = await tx.prescription.update({
        where: { id },
        data: anyDispensed ? { status: 'DISPENSED', dispensedAt: new Date() } : { status: 'CANCELLED' },
        include: prescriptionInclude,
      });
      await this.finishPharmacyVisit(tx, p.visitId);
      await this.audit.log(me, 'prescription.close', 'Prescription', id, { reason, partly: anyDispensed }, tx);
      return updated;
    });
  }

  /**
   * A patient brings drugs back. Sealed units fit to sell go back on the shelf, into the batches
   * they came from; the rest are only recorded (kept aside for destruction). Charges not yet on an
   * invoice are dropped at once; units already invoiced are refunded on the invoice by an admin,
   * and the reply says which invoices.
   */
  @Post('prescription-items/:id/return')
  @Roles('ADMIN', 'PHARMACIST')
  async returnDrugs(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ReturnSchema)) body: z.infer<typeof ReturnSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Prescription item not found');
    return this.prisma.client.$transaction(async (tx) => {
      // One change to a prescription at a time (dispensing, closing, returns).
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT p."id" FROM "Prescription" p JOIN "PrescriptionItem" i ON i."prescriptionId" = p."id"
        WHERE i."id" = ${id} AND p."tenantId" = ${me.tenantId} FOR UPDATE OF p`;
      if (!row) throw new NotFoundException('Prescription item not found');
      const item = await tx.prescriptionItem.findUniqueOrThrow({ where: { id }, include: { drug: true } });
      const withPatient = item.dispensedQty - item.returnedQty;
      if (body.quantity > withPatient) {
        throw new ConflictException(
          withPatient > 0
            ? `Only ${withPatient} ${item.drug.unit} of ${item.drug.genericName} were handed over and not yet returned`
            : `No ${item.drug.genericName} handed over on this prescription is left to return`,
        );
      }

      if (body.restocked) await this.restock(tx, me, item, body.quantity, body.reason);

      // Charged but not invoiced yet: nothing was paid, so the charge simply shrinks.
      let dropped = 0;
      const loose = await tx.charge.findMany({
        where: { source: 'PHARMACY', sourceId: id, invoiceId: null, voidedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      for (const c of loose) {
        if (dropped >= body.quantity) break;
        const take = Math.min(c.quantity, body.quantity - dropped);
        if (take === c.quantity) await tx.charge.delete({ where: { id: c.id } });
        else await tx.charge.update({ where: { id: c.id }, data: { quantity: c.quantity - take } });
        dropped += take;
      }
      const updated = await tx.prescriptionItem.update({
        where: { id },
        data: { returnedQty: { increment: body.quantity }, refundedQty: { increment: dropped } },
      });
      const record = await tx.drugReturn.create({
        data: { tenantId: me.tenantId, prescriptionItemId: id, quantity: body.quantity, restocked: body.restocked, reason: body.reason, userId: me.sub },
      });

      // Returned units still charged on an invoice: refunded there.
      const invoiced = await tx.charge.findMany({
        where: { source: 'PHARMACY', sourceId: id, voidedAt: null, invoice: { status: { not: 'VOID' } } },
        select: { quantity: true, invoice: { select: { id: true, number: true } } },
      });
      const invoicedUnits = invoiced.reduce((s, c) => s + c.quantity, 0);
      const refundDue = Math.min(updated.returnedQty - updated.refundedQty, invoicedUnits);
      const invoices = refundDue > 0 ? [...new Map(invoiced.map((c) => [c.invoice!.id, c.invoice!])).values()] : [];

      await this.audit.log(
        me,
        'prescription.return',
        'Prescription',
        item.prescriptionId,
        { drug: item.drug.genericName, quantity: body.quantity, restocked: body.restocked, reason: body.reason, refundDue },
        tx,
      );
      return { id: record.id, quantity: body.quantity, restocked: body.restocked, refundDue, unit: item.drug.unit, invoices };
    });
  }

  /** Puts returned units back into the batches they were dispensed from, latest expiry first. */
  private async restock(
    tx: Prisma.TransactionClient,
    me: AuthUser,
    item: { id: string; drug: { genericName: string; unit: string } },
    quantity: number,
    reason: string,
  ) {
    const given = await tx.$queryRaw<{ batchId: string; given: number; expiryDate: Date }[]>`
      SELECT m."batchId", (-SUM(m."quantity"))::int AS "given", b."expiryDate"
      FROM "StockMovement" m JOIN "StockBatch" b ON b."id" = m."batchId"
      WHERE m."reference" = ${item.id} AND m."type" IN ('DISPENSE', 'RETURN')
      GROUP BY m."batchId", b."expiryDate"
      HAVING -SUM(m."quantity") > 0
      ORDER BY b."expiryDate" DESC`;
    const from = usableFrom();
    let left = quantity;
    for (const b of given) {
      if (left === 0) break;
      if (b.expiryDate < from) {
        throw new ConflictException(`This ${item.drug.genericName} has expired, so it can't go back on the shelf: record it as not fit to sell`);
      }
      const put = Math.min(left, b.given);
      await tx.stockBatch.update({ where: { id: b.batchId }, data: { quantity: { increment: put } } });
      await tx.stockMovement.create({ data: { batchId: b.batchId, type: 'RETURN', quantity: put, reference: item.id, reason, userId: me.sub } });
      left -= put;
    }
    if (left > 0) {
      throw new ConflictException(`The batches these ${item.drug.unit} came from can't be found; record them as not fit to sell`);
    }
  }

  /** Drugs that can stand in for this item: same generic, strength and form (another brand), in stock first. */
  @Get('prescription-items/:id/equivalents')
  @Roles('ADMIN', 'PHARMACIST')
  async equivalents(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const item = await this.itemOf(me, id);
    // Narrowed by the first word of the name, then compared the way the swap compares them.
    const firstWord = item.drug.genericName.trim().split(/\s+/)[0];
    const candidates = await this.prisma.client.drug.findMany({
      where: { tenantId: me.tenantId, active: true, id: { not: item.drugId }, genericName: { contains: firstWord, mode: 'insensitive' } },
      orderBy: { brandName: 'asc' },
    });
    const options = candidates.filter((d) => equivalent(d, item.drug));
    const stock = await this.stockFor(me.tenantId, options.map((d) => d.id));
    return options.map((d) => ({ ...d, inStock: stock.get(d.id) ?? 0 })).sort((a, b) => Number(b.inStock > 0) - Number(a.inStock > 0));
  }

  /**
   * Gives an equivalent brand instead of the one prescribed (out of stock, or the patient asks for
   * a cheaper one). Only before anything of it is charged or handed over, so the invoice and the
   * label show what the patient actually gets. The original and the reason stay on the item.
   */
  @Post('prescription-items/:id/substitute')
  @Roles('ADMIN', 'PHARMACIST')
  async substitute(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(SubstituteSchema)) body: z.infer<typeof SubstituteSchema>) {
    return this.prisma.client.$transaction(async (tx) => {
      const item = await this.itemOf(me, id, tx);
      const p = await tx.prescription.findUniqueOrThrow({ where: { id: item.prescriptionId }, include: { visit: { include: { patient: { select: { allergies: true } } } } } });
      if (p.status !== 'PENDING' && p.status !== 'PARTIALLY_DISPENSED') {
        throw new ConflictException(`This prescription is ${p.status.toLowerCase().replace('_', ' ')}`);
      }
      if (item.billedQty > 0 || item.dispensedQty > 0) {
        throw new ConflictException(`${item.drug.genericName} has already been sent to the cashier or handed over, so it can no longer be swapped`);
      }
      const to = await tx.drug.findFirst({ where: { id: body.drugId, tenantId: me.tenantId, active: true } });
      if (!to) throw new NotFoundException('Drug not found');
      if (to.id === item.drugId || !equivalent(to, item.drug)) {
        throw new ConflictException('Only the same drug, strength and form (another brand) can be given instead. For a different drug, ask the doctor.');
      }
      if (to.controlled !== item.drug.controlled) throw new ConflictException('The substitute must have the same controlled-drug status');
      // An allergy the doctor already weighed for the prescribed drug carries over; only a new one
      // (from the substitute's brand) stops the swap.
      const allergy = allergyAlerts(p.visit.patient.allergies, [to]);
      if (allergy.length && !allergyAlerts(p.visit.patient.allergies, [item.drug]).length) {
        throw new ConflictException({ message: 'The patient is allergic to this substitute', alerts: allergy });
      }

      const describe = (d: { genericName: string; strength: string | null; form: string; brandName: string | null }) =>
        `${[d.genericName, d.strength, d.form].filter(Boolean).join(' ')}${d.brandName ? ` (${d.brandName})` : ''}`;
      const updated = await tx.prescriptionItem.update({
        where: { id },
        // A second swap keeps the first record of what the doctor prescribed.
        data: { drugId: to.id, substitutedFrom: item.substitutedFrom ?? describe(item.drug), substitutionReason: body.reason },
        include: { drug: true },
      });
      await this.audit.log(me, 'prescription.substitute', 'Prescription', item.prescriptionId, { from: describe(item.drug), to: describe(to), reason: body.reason }, tx);
      return updated;
    });
  }

  /** A prescription item of this clinic, with its drug. */
  private async itemOf(me: AuthUser, id: string, tx: Pick<Prisma.TransactionClient, 'prescriptionItem'> = this.prisma.client) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Prescription item not found');
    const item = await tx.prescriptionItem.findFirst({ where: { id, prescription: { tenantId: me.tenantId } }, include: { drug: true } });
    if (!item) throw new NotFoundException('Prescription item not found');
    return item;
  }

  /**
   * What the medicine labels print: the clinic, the patient, each drug with its directions, and
   * the batches it was dispensed from (number and expiry).
   */
  @Get('prescriptions/:id/label')
  @Roles('ADMIN', 'PHARMACIST', 'DOCTOR', 'NURSE')
  async label(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Prescription not found');
    const db = this.prisma.client;
    const p = await db.prescription.findFirst({
      where: { id, tenantId: me.tenantId },
      include: {
        ...prescriptionInclude,
        visit: { select: { id: true, kind: true, patient: { select: queuePatientSelect } } },
        tenant: { select: { name: true, nameAm: true, phone: true, address: true } },
      },
    });
    if (!p) throw new NotFoundException('Prescription not found');
    const movements = await db.stockMovement.findMany({
      where: { type: 'DISPENSE', reference: { in: p.items.map((i) => i.id) } },
      orderBy: { createdAt: 'desc' },
      select: { reference: true, userId: true, batch: { select: { batchNo: true, expiryDate: true } } },
    });
    const dispenserIds = [...new Set(movements.map((m) => m.userId).filter((u): u is string => !!u))];
    const dispensers = dispenserIds.length
      ? await db.user.findMany({ where: { tenantId: me.tenantId, id: { in: dispenserIds } }, select: { id: true, fullName: true } })
      : [];
    return {
      ...p,
      dispensedBy: dispensers.find((u) => u.id === movements[0]?.userId)?.fullName ?? null,
      items: p.items.map((i) => {
        const mine = movements.filter((m) => m.reference === i.id);
        const expiries = mine.map((m) => m.batch.expiryDate.getTime());
        return {
          ...i,
          batches: [...new Set(mine.map((m) => m.batch.batchNo))],
          expiresAt: expiries.length ? new Date(Math.min(...expiries)).toISOString() : null,
        };
      }),
    };
  }
}

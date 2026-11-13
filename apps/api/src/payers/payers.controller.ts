import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequiresFeature } from '../platform/subscription.guard.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import { payerDue } from '../billing/billing.controller.js';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .optional();

const PayerSchema = z.object({
  type: z.enum(['CREDIT', 'INSURANCE']),
  name: z.string().trim().min(2).max(200),
  phone: optional(50),
  contactPerson: optional(200),
  /** The patient's share of each covered bill, in percent. */
  coPayPercent: z.number().min(0).max(100).optional(),
  requiresAuthorization: z.boolean().optional(),
});
/** The payer's price list: its own price for an item, or that the item isn't covered. */
const TariffSchema = z.object({
  items: z
    .array(
      z.object({
        itemType: z.enum(['SERVICE', 'LAB', 'DRUG']),
        itemId: z.uuid(),
        price: z.number().min(0).max(10_000_000).nullable(),
        excluded: z.boolean().default(false),
      }),
    )
    .max(5000),
});
const PayerUpdateSchema = PayerSchema.partial().extend({ active: z.boolean().optional() });

const StatementSchema = z.object({
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
});

const SettlementSchema = z
  .object({
    method: z.enum(['CASH', 'TELEBIRR', 'CHAPA', 'BANK_TRANSFER']),
    amount: z.number().positive().max(100_000_000),
    reference: z
      .string()
      .trim()
      .max(100)
      .transform((s) => s || undefined)
      .optional(),
  })
  .refine((p) => p.method === 'CASH' || !!p.reference, { message: 'Enter the transaction or cheque reference', path: ['reference'] });

const OPEN = ['OPEN', 'PARTIALLY_PAID'] as const;

/**
 * Credit companies and insurers: their account (what they owe), a statement to send them, and
 * settlement of many invoices with one payment, oldest first.
 */
@Controller('payers')
@Roles('ADMIN', 'CASHIER')
export class PayersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async payer(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Payer not found');
    const payer = await this.prisma.client.payer.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!payer) throw new NotFoundException('Payer not found');
    return payer;
  }

  @Get()
  async list(@CurrentUser() me: AuthUser) {
    const [payers, open] = await Promise.all([
      this.prisma.client.payer.findMany({ where: { tenantId: me.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      this.prisma.client.invoice.findMany({
        where: { tenantId: me.tenantId, payerId: { not: null }, status: { in: [...OPEN] } },
        select: { payerId: true, payerType: true, total: true, paid: true, patientShare: true, patientPaid: true },
      }),
    ]);
    const due = new Map<string, { amount: number; count: number }>();
    for (const i of open.filter((x) => payerDue(x) > 0)) {
      const d = due.get(i.payerId!) ?? { amount: 0, count: 0 };
      d.amount += payerDue(i);
      d.count += 1;
      due.set(i.payerId!, d);
    }
    return payers.map((p) => ({ ...p, balance: fromCents(due.get(p.id)?.amount ?? 0), openInvoices: due.get(p.id)?.count ?? 0 }));
  }

  @Post()
  @RequiresFeature('CREDIT')
  @Roles('ADMIN')
  async create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(PayerSchema)) body: z.infer<typeof PayerSchema>) {
    const exists = await this.prisma.client.payer.findFirst({ where: { tenantId: me.tenantId, name: { equals: body.name, mode: 'insensitive' } } });
    if (exists) throw new ConflictException('A payer with this name already exists');
    const payer = await this.prisma.client.payer.create({ data: { ...body, tenantId: me.tenantId } });
    await this.audit.log(me, 'payer.create', 'Payer', payer.id, { name: payer.name, type: payer.type });
    return payer;
  }

  @Patch(':id')
  @RequiresFeature('CREDIT')
  @Roles('ADMIN')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(PayerUpdateSchema)) body: z.infer<typeof PayerUpdateSchema>) {
    await this.payer(me, id);
    const payer = await this.prisma.client.payer.update({ where: { id }, data: body });
    await this.audit.log(me, 'payer.update', 'Payer', id, { fields: Object.keys(body) });
    return payer;
  }

  /** Invoices billed to the payer in a period (default: this month), and everything still unpaid. */
  @Get(':id/statement')
  async statement(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query(new ZodPipe(StatementSchema)) q: z.infer<typeof StatementSchema>) {
    const payer = await this.payer(me, id);
    const today = clinicDay();
    const from = q.from ?? `${today.slice(0, 8)}01`;
    const to = q.to ?? today;
    const select = {
      id: true,
      number: true,
      createdAt: true,
      status: true,
      payerType: true,
      total: true,
      paid: true,
      patientShare: true,
      patientPaid: true,
      patient: { select: queuePatientSelect },
      visit: {
        select: {
          checkedInAt: true,
          memberId: true,
          authorizationNo: true,
          doctor: { select: { fullName: true } },
          diagnoses: { orderBy: { isPrimary: 'desc' }, select: { icd11Code: true, label: true, isPrimary: true } },
        },
      },
      charges: { where: { voidedAt: null }, select: { description: true, quantity: true, unitPrice: true } },
    } as const;
    const [inPeriod, unpaid, tenant] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { tenantId: me.tenantId, payerId: id, status: { not: 'VOID' }, createdAt: { gte: dayRange(from).start, lt: dayRange(to).end } },
        orderBy: { createdAt: 'asc' },
        select,
      }),
      this.prisma.client.invoice.findMany({ where: { tenantId: me.tenantId, payerId: id, status: { in: [...OPEN] } }, orderBy: { createdAt: 'asc' }, select }),
      this.prisma.client.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { name: true, nameAm: true, phone: true, address: true } }),
    ]);
    // The payer's share of each invoice (the patient's co-payment is collected from them).
    const share = (i: { total: { toString(): string }; patientShare: { toString(): string } }) => toCents(i.total) - toCents(i.patientShare);
    const withBalance = <T extends Parameters<typeof payerDue>[0]>(i: T) => ({ ...i, payerShare: fromCents(share(i)), balance: fromCents(payerDue(i)) });
    const owing = unpaid.filter((i) => payerDue(i) > 0);
    return {
      payer,
      tenant,
      from,
      to,
      invoices: inPeriod.map(withBalance),
      billed: fromCents(inPeriod.reduce((s, i) => s + share(i), 0)),
      unpaid: owing.map(withBalance),
      balance: fromCents(owing.reduce((s, i) => s + payerDue(i), 0)),
    };
  }

  /**
   * The payer's price list: every service, lab test and drug with the clinic's price, and the payer's
   * own price or exclusion where it has one.
   */
  @Get(':id/tariff')
  async tariff(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const payer = await this.payer(me, id);
    const db = this.prisma.client;
    const [services, tests, drugs, rows] = await Promise.all([
      db.serviceItem.findMany({ where: { tenantId: me.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, price: true } }),
      db.labTest.findMany({ where: { tenantId: me.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, price: true } }),
      db.drug.findMany({
        where: { tenantId: me.tenantId, active: true },
        orderBy: { genericName: 'asc' },
        select: { id: true, genericName: true, strength: true, form: true, sellPrice: true },
      }),
      db.payerTariff.findMany({ where: { payerId: id } }),
    ]);
    const entry = (type: string, itemId: string) => rows.find((r) => r.itemType === type && r.itemId === itemId);
    const line = (type: 'SERVICE' | 'LAB' | 'DRUG', itemId: string, name: string, cash: { toString(): string }) => {
      const t = entry(type, itemId);
      return { itemType: type, itemId, name, cashPrice: fromCents(toCents(cash)), price: t?.price != null ? fromCents(toCents(t.price)) : null, excluded: t?.excluded ?? false };
    };
    return {
      payer,
      items: [
        ...services.map((s) => line('SERVICE', s.id, s.name, s.price)),
        ...tests.map((t) => line('LAB', t.id, t.name, t.price)),
        ...drugs.map((d) => line('DRUG', d.id, [d.genericName, d.strength, d.form].filter(Boolean).join(' '), d.sellPrice)),
      ],
    };
  }

  /** Replaces the payer's price list (only the items with their own price or excluded are kept). */
  @Put(':id/tariff')
  @RequiresFeature('CREDIT')
  @Roles('ADMIN')
  async saveTariff(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(TariffSchema)) body: z.infer<typeof TariffSchema>) {
    const payer = await this.payer(me, id);
    const keep = body.items.filter((i) => i.excluded || i.price !== null);
    const db = this.prisma.client;
    const known = new Set<string>([
      ...(await db.serviceItem.findMany({ where: { tenantId: me.tenantId }, select: { id: true } })).map((x) => 'SERVICE:' + x.id),
      ...(await db.labTest.findMany({ where: { tenantId: me.tenantId }, select: { id: true } })).map((x) => 'LAB:' + x.id),
      ...(await db.drug.findMany({ where: { tenantId: me.tenantId }, select: { id: true } })).map((x) => 'DRUG:' + x.id),
    ]);
    if (keep.some((i) => !known.has(i.itemType + ':' + i.itemId))) throw new NotFoundException('One or more items were not found');
    await db.$transaction(async (tx) => {
      await tx.payerTariff.deleteMany({ where: { payerId: id } });
      if (keep.length) {
        await tx.payerTariff.createMany({
          data: keep.map((i) => ({ tenantId: me.tenantId, payerId: id, itemType: i.itemType, itemId: i.itemId, price: i.price === null ? null : i.price.toFixed(2), excluded: i.excluded })),
        });
      }
    });
    await this.audit.log(me, 'payer.tariff', 'Payer', id, { name: payer.name, items: keep.length });
    return { saved: keep.length };
  }

  /** One payment from the payer, applied to its unpaid invoices oldest first. */
  @Post(':id/settlements')
  async settle(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(SettlementSchema)) body: z.infer<typeof SettlementSchema>) {
    const payer = await this.payer(me, id);
    return this.prisma.client.$transaction(async (tx) => {
      const closed = await tx.cashClosing.findFirst({ where: { tenantId: me.tenantId, cashierId: me.sub, day: new Date(clinicDay()) } });
      if (closed) throw new ConflictException("You have already closed today's cash; ask another cashier or an admin");
      if (body.reference) {
        const dup = await tx.payment.findFirst({ where: { tenantId: me.tenantId, method: body.method, reference: body.reference } });
        if (dup) throw new ConflictException('This transaction reference has already been recorded');
      }
      // Lock the payer's open invoices so a payment at the counter can't race this settlement.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Invoice" WHERE "tenantId" = ${me.tenantId} AND "payerId" = ${id} AND "status" IN ('OPEN', 'PARTIALLY_PAID')
        ORDER BY "createdAt" ASC FOR UPDATE`;
      const invoices = await tx.invoice.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
      const owed = invoices.reduce((s, i) => s + payerDue(i), 0);
      let left = toCents(body.amount);
      if (left > owed) throw new ConflictException(`${payer.name} owes ${fromCents(owed)} ETB; the payment is more than that`);

      const applied: { number: string; amount: string }[] = [];
      for (const inv of invoices) {
        if (left === 0) break;
        const due = payerDue(inv);
        if (due <= 0) continue;
        const take = Math.min(due, left);
        await tx.payment.create({
          data: {
            tenantId: me.tenantId,
            invoiceId: inv.id,
            cashierId: me.sub,
            method: body.method,
            amount: fromCents(take),
            reference: body.reference,
            note: `Settlement from ${payer.name}`,
            byPayer: true,
          },
        });
        const paid = toCents(inv.paid) + take;
        await tx.invoice.update({ where: { id: inv.id }, data: { paid: fromCents(paid), status: paid >= toCents(inv.total) ? 'PAID' : 'PARTIALLY_PAID' } });
        applied.push({ number: inv.number, amount: fromCents(take) });
        left -= take;
      }
      await this.audit.log(me, 'payer.settlement', 'Payer', id, { amount: fromCents(toCents(body.amount)), method: body.method, invoices: applied.length }, tx);
      return { applied, remainingBalance: fromCents(owed - toCents(body.amount)) };
    });
  }
}

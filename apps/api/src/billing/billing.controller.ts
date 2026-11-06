import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { liveCharge } from '../common/settlement.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';

const money = z
  .number()
  .positive()
  .max(10_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most 2 decimal places');

const InvoiceSchema = z
  .object({
    visitId: z.uuid(),
    payerType: z.enum(['SELF', 'CREDIT', 'INSURANCE']).default('SELF'),
    payerId: z.uuid().optional(), // a payer from the list (preferred)
    payerName: z.string().trim().max(200).optional(), // or a name: a payer of that name is found or added
    discount: money.optional(),
    discountReason: z.string().trim().max(300).optional(),
  })
  .refine((b) => b.payerType === 'SELF' || !!b.payerId || (b.payerName && b.payerName.length >= 2), {
    message: 'Name the credit company or insurer',
    path: ['payerName'],
  })
  .refine((b) => !b.discount || (b.discountReason && b.discountReason.length >= 3), {
    message: 'Give a reason for the discount',
    path: ['discountReason'],
  });

const PaymentSchema = z
  .object({
    method: z.enum(['CASH', 'TELEBIRR', 'CHAPA', 'BANK_TRANSFER']),
    amount: money,
    reference: z
      .string()
      .trim()
      .max(100)
      .transform((s) => s || undefined)
      .optional(),
  })
  .refine((p) => p.method === 'CASH' || !!p.reference, {
    message: 'Enter the transaction reference',
    path: ['reference'],
  });

const RemoveChargeSchema = z.object({
  reason: z.string().trim().min(5, 'Explain why this is refunded').max(300),
  method: z.enum(['CASH', 'TELEBIRR', 'CHAPA', 'BANK_TRANSFER']).default('CASH'),
  reference: z
    .string()
    .trim()
    .max(100)
    .transform((s) => s || undefined)
    .optional(),
  quantity: z.number().int().min(1).optional(), // drug lines: units to refund (default: the whole line)
});
const VoidSchema = z.object({ reason: z.string().trim().min(5, 'Explain why the invoice is voided').max(300) });
const ListSchema = z.object({
  day: z.string().regex(DAY_PATTERN).optional(),
  status: z.enum(['OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
  patientId: z.uuid().optional(),
});
const DaySchema = z.object({ day: z.string().regex(DAY_PATTERN).optional() });
const ClosingSchema = z.object({
  countedCash: z.number().min(0).max(100_000_000),
  note: z.string().trim().max(500).optional(),
});

const invoiceInclude = {
  patient: { select: queuePatientSelect },
  charges: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { receivedAt: 'asc' }, include: { cashier: { select: { id: true, fullName: true } } } },
  createdBy: { select: { id: true, fullName: true } },
  visit: { select: { id: true, queueNumber: true, checkedInAt: true } },
  tenant: { select: { name: true, nameAm: true, phone: true, address: true } },
} satisfies Prisma.InvoiceInclude;

const lineTotal = (c: { quantity: number; unitPrice: { toString(): string } }) => toCents(c.unitPrice) * c.quantity;

function withBalance<T extends { total: { toString(): string }; paid: { toString(): string } }>(inv: T) {
  return { ...inv, balance: fromCents(toCents(inv.total) - toCents(inv.paid)) };
}

@Controller()
@Roles('ADMIN', 'CASHIER')
export class BillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Visits with charges that have not been invoiced yet, oldest first. */
  @Get('billing/pending')
  async pending(@CurrentUser() me: AuthUser) {
    const visits = await this.prisma.client.visit.findMany({
      where: { tenantId: me.tenantId, charges: { some: { invoiceId: null } } },
      orderBy: { checkedInAt: 'asc' },
      include: {
        patient: { select: queuePatientSelect },
        doctor: { select: { fullName: true } },
        charges: { where: { invoiceId: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    return visits.map((v) => ({ ...v, subtotal: fromCents(v.charges.reduce((s, c) => s + lineTotal(c), 0)) }));
  }

  @Post('invoices')
  async createInvoice(@CurrentUser() me: AuthUser, @Body(new ZodPipe(InvoiceSchema)) body: z.infer<typeof InvoiceSchema>) {
    if (body.discount && me.role !== 'ADMIN') throw new ForbiddenException('Only an admin can give a discount');

    const invoice = await this.prisma.client.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id: body.visitId, tenantId: me.tenantId } });
      if (!visit) throw new NotFoundException('Visit not found');
      const charges = await tx.charge.findMany({ where: { visitId: visit.id, invoiceId: null } });
      if (!charges.length) throw new ConflictException('This visit has nothing left to bill');

      let payer: { id: string; name: string } | null = null;
      if (body.payerType !== 'SELF') {
        payer = body.payerId
          ? await tx.payer.findFirst({ where: { id: body.payerId, tenantId: me.tenantId, active: true, type: body.payerType } })
          : await tx.payer.upsert({
              where: { tenantId_name: { tenantId: me.tenantId, name: body.payerName! } },
              update: {},
              create: { tenantId: me.tenantId, type: body.payerType, name: body.payerName! },
            });
        if (!payer) throw new NotFoundException('Payer not found');
      }

      const subtotal = charges.reduce((s, c) => s + lineTotal(c), 0);
      const discount = body.discount ? toCents(body.discount) : 0;
      if (discount > subtotal) throw new ConflictException('The discount is larger than the bill');

      const { nextInvoice } = await tx.tenant.update({
        where: { id: me.tenantId },
        data: { nextInvoice: { increment: 1 } },
        select: { nextInvoice: true },
      });
      const created = await tx.invoice.create({
        data: {
          tenantId: me.tenantId,
          patientId: visit.patientId,
          visitId: visit.id,
          number: `INV-${String(nextInvoice - 1).padStart(6, '0')}`,
          payerType: body.payerType,
          payerName: payer?.name,
          payerId: payer?.id,
          subtotal: fromCents(subtotal),
          discount: fromCents(discount),
          discountReason: discount ? body.discountReason : undefined,
          total: fromCents(subtotal - discount),
          // A fully discounted bill has nothing left to collect.
          status: subtotal - discount === 0 ? 'PAID' : 'OPEN',
          createdById: me.sub,
        },
      });

      // Claim the charges only if nobody else invoiced them in the meantime.
      const claimed = await tx.charge.updateMany({
        where: { id: { in: charges.map((c) => c.id) }, invoiceId: null },
        data: { invoiceId: created.id },
      });
      if (claimed.count !== charges.length) throw new ConflictException('These charges were just invoiced by someone else');

      await this.audit.log(
        me,
        'invoice.create',
        'Invoice',
        created.id,
        { number: created.number, total: fromCents(subtotal - discount), discount: fromCents(discount) },
        tx,
      );
      return created;
    });
    return this.get(me, invoice.id);
  }

  @Get('invoices')
  async list(@CurrentUser() me: AuthUser, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    const range = q.day || !q.patientId ? dayRange(q.day ?? clinicDay()) : undefined;
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        tenantId: me.tenantId,
        ...(range && { createdAt: { gte: range.start, lt: range.end } }),
        ...(q.status && { status: q.status }),
        ...(q.patientId && { patientId: q.patientId }),
      },
      orderBy: { createdAt: 'desc' },
      include: { patient: { select: queuePatientSelect }, createdBy: { select: { fullName: true } } },
    });
    return invoices.map(withBalance);
  }

  @Get('invoices/:id')
  async get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Invoice not found');
    const invoice = await this.prisma.client.invoice.findFirst({ where: { id, tenantId: me.tenantId }, include: invoiceInclude });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return withBalance(invoice);
  }

  @Post('invoices/:id/payments')
  async pay(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(PaymentSchema)) body: z.infer<typeof PaymentSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Invoice not found');

    await this.prisma.client.$transaction(async (tx) => {
      // Lock the invoice so two payments at once can't both fit into the same balance.
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "tenantId" = ${me.tenantId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Invoice not found');
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });

      if (invoice.status === 'VOID') throw new ConflictException('This invoice is void');
      const balance = toCents(invoice.total) - toCents(invoice.paid);
      const amount = toCents(body.amount);
      if (balance <= 0) throw new ConflictException('This invoice is already paid');
      if (amount > balance) throw new ConflictException(`Amount is more than the balance of ${fromCents(balance)} ETB`);

      const closed = await tx.cashClosing.findFirst({ where: { tenantId: me.tenantId, cashierId: me.sub, day: new Date(clinicDay()) } });
      if (closed) throw new ConflictException("You have already closed today's cash; ask another cashier or an admin");

      if (body.reference) {
        const dup = await tx.payment.findFirst({ where: { tenantId: me.tenantId, method: body.method, reference: body.reference } });
        if (dup) throw new ConflictException('This transaction reference has already been recorded');
      }

      await tx.payment.create({
        data: { tenantId: me.tenantId, invoiceId: id, cashierId: me.sub, method: body.method, amount: fromCents(amount), reference: body.reference },
      });
      const paid = toCents(invoice.paid) + amount;
      await tx.invoice.update({
        where: { id },
        data: { paid: fromCents(paid), status: paid >= toCents(invoice.total) ? 'PAID' : 'PARTIALLY_PAID' },
      });
      await this.audit.log(me, 'payment.create', 'Invoice', id, { method: body.method, amount: fromCents(amount) }, tx);
    });
    return this.get(me, id);
  }

  /** Admin only. Only unpaid invoices can be voided; their charges go back to "to bill". */
  @Post('invoices/:id/void')
  @Roles('ADMIN')
  async void(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(VoidSchema)) { reason }: z.infer<typeof VoidSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Invoice not found');
    await this.prisma.client.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "tenantId" = ${me.tenantId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Invoice not found');
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (invoice.status === 'VOID') throw new ConflictException('This invoice is already void');
      if (toCents(invoice.paid) > 0) throw new ConflictException('An invoice with payments cannot be voided');

      // Removed (refunded) lines stay on the void invoice as history; the rest go back to "to bill".
      await tx.charge.updateMany({ where: { invoiceId: id, ...liveCharge }, data: { invoiceId: null } });
      await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
      await this.audit.log(me, 'invoice.void', 'Invoice', id, { number: invoice.number, reason }, tx);
    });
    return this.get(me, id);
  }

  /**
   * Admin only. Removes a line whose service was never delivered (test whose sample wasn't taken,
   * drugs not handed over, consultation the patient left before) from its invoice. The test is
   * cancelled or the drug units released, the invoice total drops, and anything paid beyond the
   * new total is refunded with the chosen method. Nothing is deleted: the line stays, marked removed.
   */
  @Post('invoices/:id/charges/:chargeId/remove')
  @Roles('ADMIN')
  async removeCharge(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
    @Body(new ZodPipe(RemoveChargeSchema)) body: z.infer<typeof RemoveChargeSchema>,
  ) {
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(chargeId).success) throw new NotFoundException('Invoice line not found');
    await this.prisma.client.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "tenantId" = ${me.tenantId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Invoice not found');
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { charges: true } });
      if (invoice.status === 'VOID') throw new ConflictException('This invoice is void');
      const charge = invoice.charges.find((c) => c.id === chargeId);
      if (!charge) throw new NotFoundException('Invoice line not found');
      if (charge.voidedAt) throw new ConflictException('This line was already removed');

      // Only what the patient never received can be taken back.
      if (charge.source === 'LAB' && charge.sourceId) {
        const order = await tx.labOrder.findUnique({ where: { id: charge.sourceId } });
        if (order && order.status !== 'ORDERED' && order.status !== 'CANCELLED') {
          throw new ConflictException('The sample for this test was already taken, so it cannot be refunded');
        }
        if (order?.status === 'ORDERED') await tx.labOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      }
      // Drug lines can be refunded in part: just the units that never left the shelf.
      const units = body.quantity ?? charge.quantity;
      if (units > charge.quantity) throw new ConflictException(`This line has only ${charge.quantity} units`);
      if (units < charge.quantity && charge.source !== 'PHARMACY') throw new ConflictException('Only drug lines can be refunded in part');
      if (charge.source === 'PHARMACY' && charge.sourceId) {
        // Atomic: release only units that were billed but not handed over.
        const released = await tx.$executeRaw`
          UPDATE "PrescriptionItem" SET "billedQty" = "billedQty" - ${units}
          WHERE "id" = ${charge.sourceId} AND "billedQty" - "dispensedQty" >= ${units}`;
        if (released !== 1) throw new ConflictException('Those units were already handed over, so they cannot be refunded');
      }
      if (charge.source === 'CONSULTATION') {
        const visit = await tx.visit.findUniqueOrThrow({ where: { id: charge.visitId } });
        if (visit.status !== 'WAITING' && visit.status !== 'CANCELLED') {
          throw new ConflictException('The patient has already seen the doctor, so the consultation cannot be refunded');
        }
      }

      let live = invoice.charges.filter((c) => c.id !== chargeId && !c.voidedAt);
      if (units < charge.quantity) {
        // Keep the handed-over units on the line; record the refunded ones as a removed line.
        const kept = await tx.charge.update({ where: { id: chargeId }, data: { quantity: charge.quantity - units } });
        const { id: _id, createdAt: _at, ...copy } = charge;
        await tx.charge.create({ data: { ...copy, quantity: units, voidedAt: new Date(), voidReason: body.reason } });
        live = [...live, kept];
      } else {
        await tx.charge.update({ where: { id: chargeId }, data: { voidedAt: new Date(), voidReason: body.reason } });
      }
      const subtotal = live.reduce((s, c) => s + lineTotal(c), 0);
      const discount = Math.min(toCents(invoice.discount), subtotal);
      const total = subtotal - discount;
      const refund = Math.max(0, toCents(invoice.paid) - total);
      const paid = toCents(invoice.paid) - refund;

      if (refund > 0) {
        if (body.method !== 'CASH' && !body.reference) throw new ConflictException('Enter the transaction reference of the refund');
        await tx.payment.create({
          data: {
            tenantId: me.tenantId,
            invoiceId: id,
            cashierId: me.sub,
            method: body.method,
            amount: fromCents(-refund),
            reference: body.reference,
            note: `Refund: ${body.reason}`,
          },
        });
      }
      await tx.invoice.update({
        where: { id },
        data: {
          subtotal: fromCents(subtotal),
          discount: fromCents(discount),
          total: fromCents(total),
          paid: fromCents(paid),
          ...(live.length === 0
            ? { status: 'VOID', voidedAt: new Date(), voidReason: `All lines removed: ${body.reason}` }
            : { status: paid >= total ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'OPEN' }),
        },
      });
      await this.audit.log(
        me,
        'invoice.remove-line',
        'Invoice',
        id,
        { number: invoice.number, line: charge.description, refund: fromCents(refund), method: refund ? body.method : undefined, reason: body.reason },
        tx,
      );
    });
    return this.get(me, id);
  }

  /** The day's takings by cashier and payment method, plus closings. */
  @Get('billing/daily')
  async daily(@CurrentUser() me: AuthUser, @Query(new ZodPipe(DaySchema)) q: z.infer<typeof DaySchema>) {
    const day = q.day ?? clinicDay();
    const { start, end } = dayRange(day);
    const db = this.prisma.client;
    const [payments, invoices, closings] = await Promise.all([
      db.payment.findMany({
        where: { tenantId: me.tenantId, receivedAt: { gte: start, lt: end } },
        include: { cashier: { select: { id: true, fullName: true } } },
      }),
      db.invoice.findMany({ where: { tenantId: me.tenantId, createdAt: { gte: start, lt: end } } }),
      db.cashClosing.findMany({ where: { tenantId: me.tenantId, day: new Date(day) }, include: { cashier: { select: { id: true, fullName: true } } } }),
    ]);

    const byCashier = new Map<string, { cashier: { id: string; fullName: string }; byMethod: Record<string, number>; total: number }>();
    for (const p of payments) {
      const entry = byCashier.get(p.cashierId) ?? { cashier: p.cashier, byMethod: {}, total: 0 };
      entry.byMethod[p.method] = (entry.byMethod[p.method] ?? 0) + toCents(p.amount);
      entry.total += toCents(p.amount);
      byCashier.set(p.cashierId, entry);
    }
    const byMethod: Record<string, number> = {};
    for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + toCents(p.amount);
    const live = invoices.filter((i) => i.status !== 'VOID');
    const fmt = (rec: Record<string, number>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, fromCents(v)]));

    return {
      day,
      collected: fromCents(payments.reduce((s, p) => s + toCents(p.amount), 0)),
      byMethod: fmt(byMethod),
      cashiers: [...byCashier.values()].map((c) => ({ cashier: c.cashier, byMethod: fmt(c.byMethod), total: fromCents(c.total) })),
      invoices: {
        count: live.length,
        billed: fromCents(live.reduce((s, i) => s + toCents(i.total), 0)),
        discounts: fromCents(live.reduce((s, i) => s + toCents(i.discount), 0)),
        unpaid: fromCents(live.reduce((s, i) => s + toCents(i.total) - toCents(i.paid), 0)),
        voided: invoices.length - live.length,
      },
      closings: closings.map((c) => ({ ...c, variance: fromCents(toCents(c.countedCash) - toCents(c.expectedCash)) })),
    };
  }

  /** Closes the signed-in cashier's drawer for today. */
  @Post('billing/closings')
  async close(@CurrentUser() me: AuthUser, @Body(new ZodPipe(ClosingSchema)) body: z.infer<typeof ClosingSchema>) {
    const day = clinicDay();
    const { start, end } = dayRange(day);
    const db = this.prisma.client;
    const existing = await db.cashClosing.findFirst({ where: { tenantId: me.tenantId, cashierId: me.sub, day: new Date(day) } });
    if (existing) throw new ConflictException("You have already closed today's cash");

    const mine = await db.payment.findMany({ where: { tenantId: me.tenantId, cashierId: me.sub, receivedAt: { gte: start, lt: end } } });
    const totals: Record<string, string> = {};
    for (const m of ['CASH', 'TELEBIRR', 'CHAPA', 'BANK_TRANSFER']) {
      totals[m] = fromCents(mine.filter((p) => p.method === m).reduce((s, p) => s + toCents(p.amount), 0));
    }
    const expected = toCents(totals.CASH);
    const counted = toCents(body.countedCash);

    const closing = await db.cashClosing.create({
      data: {
        tenantId: me.tenantId,
        cashierId: me.sub,
        day: new Date(day),
        expectedCash: fromCents(expected),
        countedCash: fromCents(counted),
        totals,
        note: body.note || undefined,
      },
    });
    await this.audit.log(me, 'cash.close', 'CashClosing', closing.id, { expected: fromCents(expected), counted: fromCents(counted) });
    return { ...closing, variance: fromCents(counted - expected) };
  }
}

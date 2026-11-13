import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { coPayOf, liveCharge } from '../common/settlement.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import { usableCoverages } from './coverage.js';
import { referenceUsed } from './balance.js';

/** Why a bill is reduced or waived (reported by category). */
export const DISCOUNT_CATEGORIES = {
  STAFF: 'Staff or their family',
  POOR: 'Cannot pay (fee waiver)',
  FOLLOW_UP: 'Free follow-up',
  PROGRAMME: 'Free programme service (TB, HIV, family planning…)',
  GOODWILL: 'Goodwill',
  OTHER: 'Other',
} as const;
const DISCOUNT_CATEGORY_CODES = Object.keys(DISCOUNT_CATEGORIES) as [keyof typeof DISCOUNT_CATEGORIES, ...(keyof typeof DISCOUNT_CATEGORIES)[]];

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
    discountCategory: z.enum(DISCOUNT_CATEGORY_CODES).optional(),
    discountReason: z.string().trim().max(300).optional(),
  })
  .refine((b) => b.payerType === 'SELF' || !!b.payerId || (b.payerName && b.payerName.length >= 2), {
    message: 'Name the credit company or insurer',
    path: ['payerName'],
  })
  .refine((b) => !b.discount || !!b.discountCategory, { message: 'Say what kind of discount or exemption this is', path: ['discountCategory'] })
  .refine((b) => !b.discount || b.discountCategory !== 'OTHER' || (b.discountReason && b.discountReason.length >= 3), {
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
const cash = z.number().min(0).max(100_000_000);
const ClosingSchema = z
  .object({
    countedCash: cash,
    /** The change the drawer started the shift with (default: what the last closing left in it). */
    openingFloat: cash.optional(),
    /** Left in the drawer for the next shift; the rest is handed over. */
    floatLeft: cash.optional(),
    handedTo: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => (b.floatLeft ?? 0) <= b.countedCash, { message: 'The float left in the drawer is more than the cash counted', path: ['floatLeft'] });
const ReverseSchema = z.object({ reason: z.string().trim().min(5, 'Say what was wrong with the payment').max(300) });

const invoiceInclude = {
  patient: { select: queuePatientSelect },
  charges: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { receivedAt: 'asc' }, include: { cashier: { select: { id: true, fullName: true } } } },
  createdBy: { select: { id: true, fullName: true } },
  visit: { select: { id: true, queueNumber: true, checkedInAt: true, memberId: true, authorizationNo: true, coPayPercent: true } },
  tenant: { select: { name: true, nameAm: true, phone: true, address: true, tin: true } },
} satisfies Prisma.InvoiceInclude;

const lineTotal = (c: { quantity: number; unitPrice: { toString(): string } }) => toCents(c.unitPrice) * c.quantity;

type Money = { toString(): string };
type InvoiceMoney = { payerType: string; total: Money; paid: Money; patientShare: Money; patientPaid: Money };

/**
 * What the patient still owes on an invoice: the balance of their own, or what is left of their
 * co-payment on a payer's (in cents).
 */
export function patientDue(i: InvoiceMoney) {
  return i.payerType === 'SELF' ? toCents(i.total) - toCents(i.paid) : Math.max(0, toCents(i.patientShare) - toCents(i.patientPaid));
}

/** What the credit company or insurer still owes on its invoice (in cents): its share less what it paid. */
export function payerDue(i: InvoiceMoney) {
  if (i.payerType === 'SELF') return 0;
  return Math.max(0, toCents(i.total) - toCents(i.patientShare) - (toCents(i.paid) - toCents(i.patientPaid)));
}

function withBalance<T extends InvoiceMoney>(inv: T) {
  return {
    ...inv,
    balance: fromCents(toCents(inv.total) - toCents(inv.paid)),
    patientDue: fromCents(patientDue(inv)),
    payerDue: fromCents(payerDue(inv)),
  };
}

@Controller()
@Roles('ADMIN', 'CASHIER')
export class BillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Visits with charges that have not been invoiced yet, oldest first; for a visit billed to a payer,
   * how much is covered and the patient's part (their co-payment and anything not covered).
   */
  @Get('billing/pending')
  async pending(@CurrentUser() me: AuthUser) {
    const visits = await this.prisma.client.visit.findMany({
      where: { tenantId: me.tenantId, charges: { some: { invoiceId: null } } },
      orderBy: { checkedInAt: 'asc' },
      include: {
        // With their coverages, so the cashier can change who pays before billing.
        patient: { select: { ...queuePatientSelect, coverages: usableCoverages() } },
        doctor: { select: { fullName: true } },
        payer: { select: { id: true, name: true, type: true } },
        charges: { where: { invoiceId: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    return visits.map((v) => {
      const covered = v.charges.filter((c) => c.payerId).reduce((s, c) => s + lineTotal(c), 0);
      const own = v.charges.filter((c) => !c.payerId).reduce((s, c) => s + lineTotal(c), 0);
      return { ...v, subtotal: fromCents(covered + own), covered: fromCents(covered), patientPart: fromCents(own + coPayOf(covered, v.coPayPercent)) };
    });
  }

  /**
   * What each visit still owes: charges not invoiced yet plus the balance of its open self-pay
   * invoices. For the offline cashier, who takes payments per visit (POST visits/:id/payments).
   */
  @Get('billing/owed')
  async owed(@CurrentUser() me: AuthUser) {
    const open = { status: { in: ['OPEN' as const, 'PARTIALLY_PAID' as const] } };
    const visits = await this.prisma.client.visit.findMany({
      where: { tenantId: me.tenantId, OR: [{ charges: { some: { invoiceId: null } } }, { invoices: { some: open } }] },
      orderBy: { checkedInAt: 'asc' },
      take: 300,
      include: {
        patient: { select: queuePatientSelect },
        doctor: { select: { fullName: true } },
        payer: { select: { id: true, name: true, type: true } },
        charges: { where: { ...liveCharge, OR: [{ invoiceId: null }, { invoice: open }] }, orderBy: { createdAt: 'asc' } },
        invoices: { where: open, select: { payerType: true, total: true, paid: true, patientShare: true, patientPaid: true } },
      },
    });
    return visits
      .map(({ invoices, ...v }) => {
        // Not invoiced yet: all of the patient's own charges, and their co-payment on covered ones.
        const unbilled = v.charges.filter((c) => c.invoiceId === null);
        const own = unbilled.filter((c) => !c.payerId).reduce((s, c) => s + lineTotal(c), 0);
        const covered = unbilled.filter((c) => c.payerId).reduce((s, c) => s + lineTotal(c), 0);
        const due = invoices.reduce((s, i) => s + patientDue(i), 0);
        const paid = invoices.reduce((s, i) => s + (i.payerType === 'SELF' ? toCents(i.paid) : toCents(i.patientPaid)), 0);
        return { ...v, subtotal: fromCents(own + coPayOf(covered, v.coPayPercent) + due), paid: fromCents(paid) };
      })
      .filter((b) => toCents(b.subtotal) > 0);
  }

  @Post('invoices')
  async createInvoice(@CurrentUser() me: AuthUser, @Body(new ZodPipe(InvoiceSchema)) body: z.infer<typeof InvoiceSchema>) {
    if (body.discount && me.role !== 'ADMIN') throw new ForbiddenException('Only an admin can give a discount');

    const invoices = await this.prisma.client.$transaction(async (tx) => {
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
      return this.billVisit(tx, me, visit, charges, {
        payerType: body.payerType,
        payer,
        discount: body.discount ? toCents(body.discount) : 0,
        discountReason: body.discountReason,
        discountCategory: body.discountCategory,
      });
    });
    // The patient's own invoice if there is one (that is what they pay at the counter), else the payer's.
    const main = invoices.find((i) => i.payerType === body.payerType) ?? invoices[0];
    return { ...(await this.get(me, main.id)), invoices: invoices.map((i) => ({ id: i.id, number: i.number, payerType: i.payerType })) };
  }

  /**
   * Invoices a visit's charges. Charges covered by a payer go on an invoice to that payer, with the
   * patient's co-payment as their share of it; the rest are billed as asked (the patient by default,
   * or a payer chosen at the counter), with any discount. Inside the caller's transaction.
   */
  private async billVisit(
    tx: Prisma.TransactionClient,
    me: AuthUser,
    visit: { id: string; patientId: string; coPayPercent: Money | null },
    charges: { id: string; quantity: number; unitPrice: Money; payerId: string | null }[],
    rest: { payerType: 'SELF' | 'CREDIT' | 'INSURANCE'; payer: { id: string; name: string } | null; discount: number; discountReason?: string; discountCategory?: string },
  ) {
    const created = [];
    const covered = new Map<string, typeof charges>();
    for (const c of charges.filter((x) => x.payerId)) covered.set(c.payerId!, [...(covered.get(c.payerId!) ?? []), c]);
    for (const [payerId, lines] of covered) {
      const payer = await tx.payer.findUniqueOrThrow({ where: { id: payerId }, select: { id: true, name: true, type: true } });
      const subtotal = lines.reduce((s, c) => s + lineTotal(c), 0);
      created.push(
        await this.invoiceCharges(tx, me, visit, lines, {
          payerType: payer.type,
          payer,
          discount: 0,
          patientShare: coPayOf(subtotal, visit.coPayPercent),
        }),
      );
    }
    const own = charges.filter((c) => !c.payerId);
    if (own.length) created.push(await this.invoiceCharges(tx, me, visit, own, rest));
    else if (rest.discount) throw new ConflictException('Everything on this visit is billed to its payer; there is nothing to discount');
    return created;
  }

  /** Puts charges on a new invoice, inside the caller's transaction. */
  private async invoiceCharges(
    tx: Prisma.TransactionClient,
    me: AuthUser,
    visit: { id: string; patientId: string },
    charges: { id: string; quantity: number; unitPrice: { toString(): string } }[],
    opts: {
      payerType: 'SELF' | 'CREDIT' | 'INSURANCE';
      payer: { id: string; name: string } | null;
      discount: number;
      discountReason?: string;
      discountCategory?: string;
      /** On a payer's invoice: the patient's co-payment (cents). */
      patientShare?: number;
    },
  ) {
    const subtotal = charges.reduce((s, c) => s + lineTotal(c), 0);
    const discount = opts.discount;
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
        payerType: opts.payerType,
        payerName: opts.payer?.name,
        payerId: opts.payer?.id,
        subtotal: fromCents(subtotal),
        discount: fromCents(discount),
        discountReason: discount ? opts.discountReason : undefined,
        discountCategory: discount ? opts.discountCategory : undefined,
        total: fromCents(subtotal - discount),
        patientShare: fromCents(Math.min(opts.patientShare ?? 0, subtotal - discount)),
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
      { number: created.number, total: fromCents(subtotal - discount), discount: fromCents(discount), ...(discount && { category: opts.discountCategory }) },
      tx,
    );
    return created;
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

  /**
   * The receipt was printed (its Print button): the first print is the original, every later one
   * says COPY, so a receipt can't be printed again as if new.
   */
  @Post('invoices/:id/printed')
  async printed(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Invoice not found');
    const inv = await this.prisma.client.invoice.findFirst({ where: { id, tenantId: me.tenantId }, select: { id: true, number: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const { receiptPrints } = await this.prisma.client.invoice.update({ where: { id }, data: { receiptPrints: { increment: 1 } }, select: { receiptPrints: true } });
    await this.audit.log(me, 'receipt.print', 'Invoice', id, { number: inv.number, copy: receiptPrints > 1 ? receiptPrints - 1 : undefined });
    return { prints: receiptPrints };
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
    await this.prisma.client.$transaction((tx) => this.payInvoice(tx, me, id, toCents(body.amount), body.method, body.reference));
    return this.get(me, id);
  }

  /** Records a payment on one invoice, inside the caller's transaction. Amount in cents. */
  private async payInvoice(
    tx: Prisma.TransactionClient,
    me: AuthUser,
    id: string,
    amount: number,
    method: z.infer<typeof PaymentSchema>['method'],
    reference?: string,
  ) {
    // Lock the invoice so two payments at once can't both fit into the same balance.
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "tenantId" = ${me.tenantId} FOR UPDATE`;
    if (!row) throw new NotFoundException('Invoice not found');
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });

    if (invoice.status === 'VOID') throw new ConflictException('This invoice is void');
    // At the counter the patient pays their own invoice, or their co-payment on a payer's (the payer
    // settles its part from its account).
    const own = invoice.payerType === 'SELF';
    const balance = patientDue(invoice);
    if (balance <= 0) {
      throw new ConflictException(
        own ? 'This invoice is already paid' : `The patient's share of this invoice is paid; the rest is billed to ${invoice.payerName}`,
      );
    }
    if (amount > balance) throw new ConflictException(`Amount is more than the ${own ? 'balance' : "patient's share"} of ${fromCents(balance)} ETB`);

    // (After a closing, a payment simply starts the cashier's next shift.)
    if (reference && (await referenceUsed(tx, me.tenantId, method, reference))) {
      throw new ConflictException('This transaction reference has already been recorded');
    }

    await tx.payment.create({
      data: { tenantId: me.tenantId, invoiceId: id, cashierId: me.sub, method, amount: fromCents(amount), reference },
    });
    const paid = toCents(invoice.paid) + amount;
    await tx.invoice.update({
      where: { id },
      data: {
        paid: fromCents(paid),
        ...(!own && { patientPaid: fromCents(toCents(invoice.patientPaid) + amount) }),
        status: paid >= toCents(invoice.total) ? 'PAID' : 'PARTIALLY_PAID',
      },
    });
    await this.audit.log(me, 'payment.create', 'Invoice', id, { method, amount: fromCents(amount) }, tx);
  }

  /**
   * A payment toward everything a visit owes (the offline cashier works per visit, not per
   * invoice): bills the charges not invoiced yet, then pays the visit's open self-pay invoices,
   * oldest first. Instalments work; a payment someone else already took is refused clearly.
   */
  @Post('visits/:id/payments')
  async payVisit(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(PaymentSchema)) body: z.infer<typeof PaymentSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const invoiceIds = await this.prisma.client.$transaction(async (tx) => {
      // One payment toward a visit at a time.
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Visit" WHERE "id" = ${id} AND "tenantId" = ${me.tenantId} FOR UPDATE`;
      if (!locked) throw new NotFoundException('Visit not found');
      const visit = await tx.visit.findUniqueOrThrow({ where: { id }, select: { id: true, patientId: true, coPayPercent: true } });
      const unbilled = await tx.charge.findMany({ where: { visitId: id, invoiceId: null } });
      if (unbilled.length) await this.billVisit(tx, me, visit, unbilled, { payerType: 'SELF', payer: null, discount: 0 });

      // What the patient owes: their own invoices, and their co-payment on the payer's.
      const open = (
        await tx.invoice.findMany({
          where: { visitId: id, tenantId: me.tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
          orderBy: { createdAt: 'asc' },
        })
      ).filter((i) => patientDue(i) > 0);
      const owed = open.reduce((s, i) => s + patientDue(i), 0);
      if (owed <= 0) throw new ConflictException({ message: 'Nothing is owed on this visit any more', code: 'NOTHING_OWED' });
      let amount = toCents(body.amount);
      if (amount > owed) {
        throw new ConflictException({ message: `Amount is more than the ${fromCents(owed)} ETB owed on this visit`, code: 'MORE_THAN_OWED' });
      }

      const paid: string[] = [];
      for (const inv of open) {
        const portion = Math.min(amount, patientDue(inv));
        if (portion <= 0) continue;
        // A transaction reference belongs to one payment row (duplicates are refused).
        await this.payInvoice(tx, me, inv.id, portion, body.method, paid.length ? undefined : body.reference);
        paid.push(inv.id);
        amount -= portion;
        if (amount <= 0) break;
      }
      return paid;
    });
    return { visitId: id, invoices: await Promise.all(invoiceIds.map((i) => this.get(me, i))) };
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
        // Atomic: refund units the patient brought back to the pharmacy and weren't refunded yet…
        const returned = await tx.$executeRaw`
          UPDATE "PrescriptionItem" SET "refundedQty" = "refundedQty" + ${units}
          WHERE "id" = ${charge.sourceId} AND "returnedQty" - "refundedQty" >= ${units}`;
        // …or else release units that were billed but never handed over.
        const released =
          returned === 1
            ? 1
            : await tx.$executeRaw`
                UPDATE "PrescriptionItem" SET "billedQty" = "billedQty" - ${units}
                WHERE "id" = ${charge.sourceId} AND "billedQty" - "dispensedQty" >= ${units}`;
        if (released !== 1) {
          throw new ConflictException('Those units are with the patient. If they brought them back, record the return at the pharmacy first.');
        }
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
      let refund: number;
      let patientShare = toCents(invoice.patientShare);
      let patientPaid = toCents(invoice.patientPaid);
      if (invoice.payerType === 'SELF') {
        refund = Math.max(0, toCents(invoice.paid) - total);
      } else {
        // A payer's invoice: the co-payment shrinks with the bill; the patient gets back what they
        // paid beyond their new share. What the payer already paid can't be undone here.
        const visit = invoice.visitId ? await tx.visit.findUnique({ where: { id: invoice.visitId }, select: { coPayPercent: true } }) : null;
        patientShare = Math.min(coPayOf(total, visit?.coPayPercent), total);
        refund = Math.max(0, patientPaid - patientShare);
        patientPaid -= refund;
        const byPayer = toCents(invoice.paid) - toCents(invoice.patientPaid);
        if (byPayer > total - patientShare) throw new ConflictException(`${invoice.payerName} has already paid for this; settle the difference with them first`);
      }
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
          patientShare: fromCents(patientShare),
          patientPaid: fromCents(patientPaid),
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
      db.cashClosing.findMany({
        where: { tenantId: me.tenantId, day: new Date(day) },
        orderBy: { createdAt: 'asc' }, // a cashier's shifts in order
        include: { cashier: { select: { id: true, fullName: true } } },
      }),
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

  /**
   * The signed-in cashier's current shift: since their last closing (if it was today or yesterday,
   * so a night shift carries over) or else since the start of today; the money taken in it by
   * method, and the float the drawer was left with at the last closing.
   */
  private async currentShift(me: AuthUser) {
    const db = this.prisma.client;
    const today = dayRange(clinicDay()).start;
    const yesterday = new Date(today.getTime() - 86_400_000);
    const [last, drawer] = await Promise.all([
      db.cashClosing.findFirst({ where: { tenantId: me.tenantId, cashierId: me.sub }, orderBy: { createdAt: 'desc' } }),
      db.cashClosing.findFirst({ where: { tenantId: me.tenantId, createdAt: { gte: yesterday } }, orderBy: { createdAt: 'desc' }, select: { floatLeft: true } }),
    ]);
    const start = last && last.createdAt >= yesterday ? last.createdAt : today;
    const payments = await db.payment.findMany({ where: { tenantId: me.tenantId, cashierId: me.sub, receivedAt: { gt: start } } });
    const totals: Record<string, string> = {};
    for (const m of ['CASH', 'TELEBIRR', 'CHAPA', 'BANK_TRANSFER']) {
      totals[m] = fromCents(payments.filter((p) => p.method === m).reduce((s, p) => s + toCents(p.amount), 0));
    }
    return { start, last, payments: payments.length, totals, cash: toCents(totals.CASH), suggestedFloat: toCents(drawer?.floatLeft ?? 0) };
  }

  /** What the closing form shows: the shift so far and the float to start from. */
  @Get('billing/shift')
  async shift(@CurrentUser() me: AuthUser) {
    const s = await this.currentShift(me);
    return {
      periodStart: s.start,
      payments: s.payments,
      totals: s.totals,
      cash: fromCents(s.cash),
      suggestedFloat: fromCents(s.suggestedFloat),
      lastClosing: s.last && { id: s.last.id, createdAt: s.last.createdAt, day: s.last.day },
    };
  }

  /**
   * Closes the signed-in cashier's shift: the cash counted against the float it started with plus
   * the cash taken, what is left in the drawer for the next shift, and who took the rest. A cashier
   * may close several shifts a day; a shift with nothing taken can't be closed twice.
   */
  @Post('billing/closings')
  async close(@CurrentUser() me: AuthUser, @Body(new ZodPipe(ClosingSchema)) body: z.infer<typeof ClosingSchema>) {
    const day = clinicDay();
    const s = await this.currentShift(me);
    if (s.payments === 0 && s.last && clinicDay(s.last.createdAt) === day) {
      throw new ConflictException('Nothing has been taken since your last closing');
    }
    const float = body.openingFloat === undefined ? s.suggestedFloat : toCents(body.openingFloat);
    const expected = float + s.cash;
    const counted = toCents(body.countedCash);

    const closing = await this.prisma.client.cashClosing.create({
      data: {
        tenantId: me.tenantId,
        cashierId: me.sub,
        day: new Date(day),
        periodStart: s.start,
        openingFloat: fromCents(float),
        expectedCash: fromCents(expected),
        countedCash: fromCents(counted),
        floatLeft: fromCents(toCents(body.floatLeft ?? 0)),
        handedTo: body.handedTo || undefined,
        totals: s.totals,
        note: body.note || undefined,
      },
    });
    await this.audit.log(me, 'cash.close', 'CashClosing', closing.id, { expected: fromCents(expected), counted: fromCents(counted), handedTo: body.handedTo });
    return { ...closing, variance: fromCents(counted - expected) };
  }

  /**
   * Admin only. Undoes a payment recorded by mistake (wrong amount, wrong method, wrong patient): a
   * reversing entry is added against the same cashier, nothing is edited or deleted, and the invoice
   * owes again what the payment had covered. The money is then recorded again correctly.
   */
  @Post('payments/:id/reverse')
  @Roles('ADMIN')
  async reverse(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ReverseSchema)) { reason }: z.infer<typeof ReverseSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Payment not found');
    const invoiceId = await this.prisma.client.$transaction(async (tx) => {
      const p = await tx.payment.findFirst({ where: { id, tenantId: me.tenantId } });
      if (!p) throw new NotFoundException('Payment not found');
      if (toCents(p.amount) <= 0 || p.reversalOfId) throw new ConflictException('Only a payment received can be reversed (not a refund or a reversal)');
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${p.invoiceId} FOR UPDATE`;
      if (!row) throw new NotFoundException('Invoice not found');
      if (await tx.payment.findUnique({ where: { reversalOfId: id } })) throw new ConflictException('This payment was already reversed');
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
      const amount = toCents(p.amount);
      await tx.payment.create({
        data: {
          tenantId: me.tenantId,
          invoiceId: p.invoiceId,
          cashierId: p.cashierId, // it comes off that cashier's takings
          method: p.method,
          amount: fromCents(-amount),
          note: `Reversed: ${reason}`,
          byPayer: p.byPayer,
          reversalOfId: id,
        },
      });
      const paid = toCents(inv.paid) - amount;
      const fromPatient = inv.payerType !== 'SELF' && !p.byPayer;
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          paid: fromCents(paid),
          ...(fromPatient && { patientPaid: fromCents(Math.max(0, toCents(inv.patientPaid) - amount)) }),
          ...(inv.status !== 'VOID' && { status: paid >= toCents(inv.total) ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'OPEN' }),
        },
      });
      await this.audit.log(me, 'payment.reverse', 'Invoice', inv.id, { number: inv.number, amount: fromCents(amount), method: p.method, reason }, tx);
      return inv.id;
    });
    return this.get(me, invoiceId);
  }
}

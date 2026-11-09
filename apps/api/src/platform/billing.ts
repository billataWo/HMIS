import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Db, PlatformPaymentMethod } from '@hmis/db';
import { fromCents, toCents } from '../common/money.js';
import { forgetSubscription } from './subscription.guard.js';
import { addPeriod } from './subscription-state.js';

const DAY = 86_400_000;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

/** Where the next period starts: at the end of the trial or the last paid period; today after a long lapse. */
export function nextPeriodStart(sub: { status: string; trialEndsAt: Date | null; paidUntil: Date | null; graceDays: number }, now = new Date()) {
  const start = (sub.status === 'TRIAL' ? sub.trialEndsAt : sub.paidUntil) ?? now;
  return start.getTime() < now.getTime() - sub.graceDays * DAY ? now : start;
}

/**
 * The invoice for a clinic's next subscription period, at its plan's current price plus VAT.
 * One open invoice at a time. The period follows on from the end of the last one paid (or of the
 * trial). After a long suspension it starts today instead: read-only months are not charged.
 */
export async function issueInvoice(db: Db, tenantId: string, operatorId: string | null, now = new Date()) {
  return db.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) throw new NotFoundException('This clinic has no subscription');
    if (sub.status === 'CANCELLED' || sub.cancelledAt) throw new ConflictException('The subscription is cancelled');
    const open = await tx.platformInvoice.findFirst({ where: { subscriptionId: sub.id, status: 'OPEN' } });
    if (open) throw new ConflictException(`Invoice ${open.number} is still open: void it first, or record its payment.`);

    const start = nextPeriodStart(sub, now);
    const end = addPeriod(start, sub.billingCycle);

    const settings = await tx.platformSetting.update({ where: { id: 1 }, data: { nextInvoice: { increment: 1 } } });
    const number = `HMIS-${now.getUTCFullYear()}-${String(settings.nextInvoice - 1).padStart(5, '0')}`;
    const subtotal = toCents(sub.billingCycle === 'YEARLY' ? sub.plan.priceYearly : sub.plan.priceMonthly);
    const vat = Math.round((subtotal * toCents(settings.vatPercent)) / 10_000);
    return tx.platformInvoice.create({
      data: {
        number,
        tenantId,
        subscriptionId: sub.id,
        planName: sub.plan.name,
        cycle: sub.billingCycle,
        periodStart: start,
        periodEnd: end,
        subtotal: fromCents(subtotal),
        vat: fromCents(vat),
        total: fromCents(subtotal + vat),
        // Due when the period starts; for a period that has already started, within a week.
        dueDate: start > now ? start : new Date(now.getTime() + 7 * DAY),
        createdById: operatorId,
      },
    });
  });
}

/**
 * A confirmed payment counts towards its invoice. Once the invoice is fully paid, the subscription
 * runs until the end of the invoiced period (a trial becomes active).
 */
async function settle(tx: Tx, invoiceId: string, now: Date) {
  const invoice = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { where: { status: 'CONFIRMED' } } } });
  const paid = invoice.payments.reduce((sum, p) => sum + toCents(p.amount), 0);
  if (invoice.status !== 'OPEN' || paid < toCents(invoice.total)) return { invoice, paidInFull: false };
  const updated = await tx.platformInvoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: now } });
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId } });
  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      paidUntil: sub.paidUntil && sub.paidUntil > invoice.periodEnd ? sub.paidUntil : invoice.periodEnd,
      ...(sub.status === 'TRIAL' && { status: 'ACTIVE' }),
    },
  });
  forgetSubscription(invoice.tenantId);
  return { invoice: updated, paidInFull: true };
}

/** A payment HMIS has received (recorded in the console, or confirmed by Chapa/Telebirr). */
export async function recordPayment(
  db: Db,
  input: { invoiceId: string; amount: string; method: PlatformPaymentMethod; reference?: string | null; paidAt: Date; operatorId: string | null; provider?: object },
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice) throw new NotFoundException();
    if (invoice.status !== 'OPEN') throw new ConflictException(`Invoice ${invoice.number} is ${invoice.status.toLowerCase()}`);
    if (input.reference && (await tx.platformPayment.findFirst({ where: { method: input.method, reference: input.reference } }))) {
      throw new ConflictException('A payment with this reference is already recorded');
    }
    const payment = await tx.platformPayment.create({
      data: {
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        amount: input.amount,
        method: input.method,
        status: 'CONFIRMED',
        reference: input.reference || null,
        paidAt: input.paidAt,
        reportedById: input.operatorId,
        reviewedById: input.operatorId,
        reviewedAt: now,
        provider: input.provider,
      },
    });
    return { payment, ...(await settle(tx, invoice.id, now)) };
  });
}

/** HMIS checked a payment the clinic reported (e.g. found the bank transfer): it counts now. */
export async function confirmPayment(db: Db, paymentId: string, operatorId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const payment = await tx.platformPayment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!payment) throw new NotFoundException();
    if (payment.status !== 'PENDING') throw new ConflictException(`This payment is already ${payment.status.toLowerCase()}`);
    if (payment.invoice.status !== 'OPEN') throw new ConflictException(`Invoice ${payment.invoice.number} is ${payment.invoice.status.toLowerCase()}`);
    const confirmed = await tx.platformPayment.update({ where: { id: paymentId }, data: { status: 'CONFIRMED', reviewedById: operatorId, reviewedAt: now } });
    return { payment: confirmed, ...(await settle(tx, payment.invoiceId, now)) };
  });
}

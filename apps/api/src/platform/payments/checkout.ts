import { randomBytes } from 'node:crypto';
import { BadGatewayException, BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { Db } from '@hmis/db';
import { fromCents, toCents } from '../../common/money.js';
import { recordPayment } from '../billing.js';
import { chapaCheckout, chapaConfig, chapaVerify, type ProviderResult } from './chapa.js';
import { telebirrCheckout, telebirrConfig, telebirrQuery } from './telebirr.js';

const log = new Logger('Payments');

/** The address the payment providers send people and notifications back to (the HMIS cloud). */
export const publicUrl = () => process.env.HMIS_PUBLIC_URL?.replace(/\/+$/, '') || null;

/** Which online payments clinics can use (each needs its settings and the public address). */
export function onlineMethods() {
  const reachable = !!publicUrl();
  return { CHAPA: reachable && !!chapaConfig(), TELEBIRR: reachable && !!telebirrConfig() };
}

export type Provider = 'CHAPA' | 'TELEBIRR';

/**
 * Sends the clinic to Chapa or Telebirr to pay what is left of an invoice. A checkout row ties our
 * reference at the provider to the invoice, so the confirmation can find it.
 */
export async function startCheckout(db: Db, input: { invoiceId: string; tenantId: string; provider: Provider; payer: { id: string; fullName: string; phone: string; email: string | null } }) {
  if (!onlineMethods()[input.provider]) throw new BadRequestException(`Paying with ${input.provider === 'CHAPA' ? 'Chapa' : 'telebirr'} is not available`);
  const invoice = await db.platformInvoice.findFirst({ where: { id: input.invoiceId, tenantId: input.tenantId }, include: { payments: { where: { status: 'CONFIRMED' } } } });
  if (!invoice) throw new NotFoundException();
  if (invoice.status !== 'OPEN') throw new ConflictException(`Invoice ${invoice.number} is ${invoice.status.toLowerCase()}`);
  const due = toCents(invoice.total) - invoice.payments.reduce((s, p) => s + toCents(p.amount), 0);
  if (due <= 0) throw new ConflictException('Nothing is left to pay on this invoice');
  const amount = fromCents(due);

  // Letters and digits only (Telebirr's order id); unique, and not guessable.
  const reference = `HMIS${invoice.number.replace(/\D/g, '')}${randomBytes(5).toString('hex').toUpperCase()}`;
  const checkout = await db.platformCheckout.create({
    data: { reference, provider: input.provider, invoiceId: invoice.id, tenantId: input.tenantId, amount, createdById: input.payer.id },
  });
  const base = publicUrl()!;
  const back = `${base}/settings/subscription/paid?ref=${reference}`;
  try {
    let url: string;
    if (input.provider === 'CHAPA') {
      const [first, ...rest] = input.payer.fullName.trim().split(/\s+/);
      url = await chapaCheckout({
        txRef: reference,
        amount,
        firstName: first || 'HMIS',
        lastName: rest.join(' ') || 'Clinic',
        phone: input.payer.phone,
        email: input.payer.email,
        callbackUrl: `${base}/public/payments/chapa/callback`,
        returnUrl: back,
        description: `Invoice ${invoice.number}`,
      });
    } else {
      url = await telebirrCheckout({ merchOrderId: reference, title: `HMIS invoice ${invoice.number}`, amount, notifyUrl: `${base}/public/payments/telebirr/notify`, redirectUrl: back });
    }
    await db.platformCheckout.update({ where: { id: checkout.id }, data: { checkoutUrl: url } });
    return { reference, url };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.platformCheckout.update({ where: { id: checkout.id }, data: { status: 'FAILED', lastError: message.slice(0, 500) } });
    log.error(`${input.provider} checkout ${reference}: ${message}`);
    throw new BadGatewayException(`${input.provider === 'CHAPA' ? 'Chapa' : 'telebirr'} is not available right now. Try again in a few minutes, or pay by bank transfer.`);
  }
}

const ask = (provider: string, reference: string): Promise<ProviderResult> => (provider === 'CHAPA' ? chapaVerify(reference) : telebirrQuery(reference));

/**
 * Asks the provider about a checkout and, if it is paid, records the payment on the invoice (once,
 * however many times this runs: a return, a callback, a webhook and the background check may all
 * arrive). Never trusts what the payer's browser or a notification says.
 */
export async function settleCheckout(db: Db, reference: string) {
  const checkout = await db.platformCheckout.findUnique({ where: { reference } });
  if (!checkout) throw new NotFoundException();
  if (checkout.status === 'PAID') return checkout;

  let result: ProviderResult;
  try {
    result = await ask(checkout.provider, reference);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return db.platformCheckout.update({ where: { id: checkout.id }, data: { checkedAt: new Date(), lastError: message.slice(0, 500) } });
  }
  if (result.status === 'pending') return db.platformCheckout.update({ where: { id: checkout.id }, data: { checkedAt: new Date() } });
  if (result.status === 'failed') return db.platformCheckout.update({ where: { id: checkout.id }, data: { status: 'FAILED', checkedAt: new Date(), completedAt: new Date() } });

  // Paid. What counts is what the provider says was paid, in birr.
  if ((result.currency ?? 'ETB').toUpperCase() !== 'ETB' || !result.amount || !(toCents(result.amount) > 0)) {
    log.error(`${checkout.provider} ${reference}: paid, but in ${result.currency} ${result.amount}: not applied`);
    return db.platformCheckout.update({
      where: { id: checkout.id },
      data: { status: 'PAID', checkedAt: new Date(), completedAt: new Date(), lastError: `Paid ${result.amount} ${result.currency}: check and apply it by hand` },
    });
  }
  const amount = fromCents(toCents(result.amount));
  try {
    const { payment, paidInFull } = await recordPayment(db, {
      invoiceId: checkout.invoiceId,
      amount,
      method: checkout.provider,
      reference, // unique per method: the same checkout can never be recorded twice
      paidAt: new Date(),
      operatorId: null,
      provider: { providerReference: result.providerReference, response: result.raw as object },
    });
    await db.platformAuditLog.create({
      data: { action: 'payment.online', entity: 'PlatformPayment', entityId: payment.id, tenantId: checkout.tenantId, data: { provider: checkout.provider, reference, amount, paidInFull } },
    });
    const done = await db.platformCheckout.update({ where: { id: checkout.id }, data: { status: 'PAID', checkedAt: new Date(), completedAt: new Date(), paymentId: payment.id, lastError: null } });
    if (toCents(amount) !== toCents(checkout.amount)) log.warn(`${reference}: paid ${amount}, expected ${checkout.amount}`);
    return done;
  } catch (e) {
    const again = await db.platformCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    if (again.status === 'PAID') return again; // recorded meanwhile by another confirmation
    const existing = await db.platformPayment.findFirst({ where: { method: checkout.provider, reference } });
    if (existing) {
      return db.platformCheckout.update({ where: { id: checkout.id }, data: { status: 'PAID', checkedAt: new Date(), completedAt: new Date(), paymentId: existing.id, lastError: null } });
    }
    // Money taken, but the invoice was meanwhile paid another way or voided: HMIS sorts it out.
    const message = e instanceof Error ? e.message : String(e);
    log.error(`${reference}: paid ${amount} but not applied: ${message}`);
    await db.platformAuditLog.create({
      data: { action: 'payment.online_unapplied', entity: 'PlatformCheckout', entityId: checkout.id, tenantId: checkout.tenantId, data: { provider: checkout.provider, reference, amount, reason: message } },
    });
    return db.platformCheckout.update({
      where: { id: checkout.id },
      data: { status: 'PAID', checkedAt: new Date(), completedAt: new Date(), lastError: `Paid ${amount} ETB but not applied (${message}): refund it or apply it to another invoice` },
    });
  }
}

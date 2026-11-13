import type { Prisma } from '@hmis/db';

/** Selects what isSettled needs from a charge, its invoice and its visit. */
export const settlementSelect = {
  voidedAt: true,
  payerId: true,
  visit: { select: { coPayPercent: true } },
  invoice: { select: { status: true, payerType: true, patientShare: true, patientPaid: true } },
} satisfies Prisma.ChargeSelect;

type Money = { toString(): string };
type ChargeForSettlement = {
  voidedAt?: Date | null;
  payerId?: string | null;
  visit?: { coPayPercent: Money | null } | null;
  invoice: { status: string; payerType: string; patientShare?: Money; patientPaid?: Money } | null;
};

const cents = (m: Money | null | undefined) => Math.round(Number(m ?? 0) * 100);

/**
 * A charge is settled (the service may go ahead under pay-first) when:
 * - its invoice is fully paid; or
 * - it is billed to a credit company or insurer and the patient has paid their co-payment on that
 *   invoice (the clinic collects the rest from the payer later); or
 * - it is covered by a payer with no co-payment, even before it is invoiced.
 * Unbilled self-pay, part-paid, void and removed (refunded) charges are not settled.
 */
export function isSettled(c: ChargeForSettlement): boolean {
  if (c.voidedAt) return false;
  if (!c.invoice) return !!c.payerId && cents(c.visit?.coPayPercent) === 0;
  if (c.invoice.status === 'VOID') return false;
  if (c.invoice.status === 'PAID') return true;
  if (c.invoice.payerType === 'SELF') return false;
  return cents(c.invoice.patientPaid) >= cents(c.invoice.patientShare);
}

/** The patient's co-payment on an amount covered by a payer (cents in, cents out). */
export function coPayOf(amountCents: number, coPayPercent: Money | null | undefined) {
  return Math.round((amountCents * Number(coPayPercent ?? 0)) / 100);
}

/** Charges that still count: not removed from their invoice. */
export const liveCharge = { voidedAt: null } satisfies Prisma.ChargeWhereInput;

export async function prepaymentRequired(tx: Prisma.TransactionClient | { tenant: Prisma.TransactionClient['tenant'] }, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { requirePrepayment: true } });
  return t.requirePrepayment;
}

/**
 * The price and payer of a new charge on a visit: a visit billed to a payer is charged at the
 * payer's tariff (its own price, or the clinic's), unless the payer excludes the item, which the
 * patient then pays in full at the clinic's price.
 */
export async function chargeTerms(
  tx: Pick<Prisma.TransactionClient, 'payerTariff'>,
  visit: { payerId: string | null },
  itemType: 'SERVICE' | 'LAB' | 'DRUG',
  itemId: string,
  cashPrice: Money,
): Promise<{ unitPrice: string; payerId: string | null }> {
  const cash = Number(cashPrice).toFixed(2);
  if (!visit.payerId) return { unitPrice: cash, payerId: null };
  const t = await tx.payerTariff.findUnique({ where: { payerId_itemType_itemId: { payerId: visit.payerId, itemType, itemId } } });
  if (t?.excluded) return { unitPrice: cash, payerId: null };
  return { unitPrice: t?.price != null ? Number(t.price).toFixed(2) : cash, payerId: visit.payerId };
}

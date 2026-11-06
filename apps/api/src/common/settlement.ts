import type { Prisma } from '@hmis/db';

/** Selects what isSettled needs from a charge and its invoice. */
export const settlementSelect = { voidedAt: true, invoice: { select: { status: true, payerType: true } } } satisfies Prisma.ChargeSelect;

type ChargeForSettlement = { voidedAt?: Date | null; invoice: { status: string; payerType: string } | null };

/**
 * A charge is settled when its invoice is fully paid, or when it is billed to a credit company or
 * insurer (the clinic collects from them later). Unbilled, unpaid, part-paid, void and removed
 * (refunded) charges are not.
 */
export function isSettled(c: ChargeForSettlement): boolean {
  if (c.voidedAt || !c.invoice || c.invoice.status === 'VOID') return false;
  return c.invoice.status === 'PAID' || c.invoice.payerType !== 'SELF';
}

/** Charges that still count: not removed from their invoice. */
export const liveCharge = { voidedAt: null } satisfies Prisma.ChargeWhereInput;

export async function prepaymentRequired(tx: Prisma.TransactionClient | { tenant: Prisma.TransactionClient['tenant'] }, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { requirePrepayment: true } });
  return t.requirePrepayment;
}

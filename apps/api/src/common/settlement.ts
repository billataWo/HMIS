import type { Prisma } from '@hmis/db';

/** Selects what isSettled needs from a charge's invoice. */
export const settlementSelect = { invoice: { select: { status: true, payerType: true } } } satisfies Prisma.ChargeSelect;

type ChargeForSettlement = { invoice: { status: string; payerType: string } | null };

/**
 * A charge is settled when its invoice is fully paid, or when it is billed to a credit company or
 * insurer (the clinic collects from them later). Unbilled, unpaid, part-paid and void are not.
 */
export function isSettled(c: ChargeForSettlement): boolean {
  if (!c.invoice || c.invoice.status === 'VOID') return false;
  return c.invoice.status === 'PAID' || c.invoice.payerType !== 'SELF';
}

export async function prepaymentRequired(tx: Prisma.TransactionClient | { tenant: Prisma.TransactionClient['tenant'] }, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { requirePrepayment: true } });
  return t.requirePrepayment;
}

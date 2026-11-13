import type { Prisma } from '@hmis/db';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { coPayOf } from '../common/settlement.js';

type Db = Pick<Prisma.TransactionClient, 'visit' | 'payment'>;
const OPEN = ['OPEN', 'PARTIALLY_PAID'] as const;

/**
 * What patients still owe, visit by visit: their open invoices (their own balance, or what is left
 * of a co-payment) and charges not invoiced yet (their own in full, their co-payment on covered
 * ones). "Earlier" is what is owed from visits before today, to ask for at check-in.
 */
export async function patientBalances(db: Db, tenantId: string, patientIds: string[]) {
  const visits = await db.visit.findMany({
    where: {
      tenantId,
      patientId: { in: patientIds },
      status: { not: 'CANCELLED' },
      OR: [{ charges: { some: { invoiceId: null, voidedAt: null } } }, { invoices: { some: { status: { in: [...OPEN] } } } }],
    },
    orderBy: { checkedInAt: 'asc' },
    select: {
      id: true,
      patientId: true,
      checkedInAt: true,
      kind: true,
      coPayPercent: true,
      charges: { where: { invoiceId: null, voidedAt: null }, select: { unitPrice: true, quantity: true, payerId: true } },
      invoices: { where: { status: { in: [...OPEN] } }, select: { payerType: true, total: true, paid: true, patientShare: true, patientPaid: true } },
    },
  });
  const today = dayRange(clinicDay()).start;
  const out = new Map<string, { owed: number; earlier: number; visits: { visitId: string; checkedInAt: Date; kind: string; owed: string }[] }>();
  for (const v of visits) {
    const own = v.charges.filter((c) => !c.payerId).reduce((s, c) => s + toCents(c.unitPrice) * c.quantity, 0);
    const covered = v.charges.filter((c) => c.payerId).reduce((s, c) => s + toCents(c.unitPrice) * c.quantity, 0);
    const invoiced = v.invoices.reduce(
      (s, i) => s + (i.payerType === 'SELF' ? toCents(i.total) - toCents(i.paid) : Math.max(0, toCents(i.patientShare) - toCents(i.patientPaid))),
      0,
    );
    const owed = own + coPayOf(covered, v.coPayPercent) + invoiced;
    if (owed <= 0) continue;
    const b = out.get(v.patientId) ?? { owed: 0, earlier: 0, visits: [] };
    b.owed += owed;
    if (v.checkedInAt < today) b.earlier += owed;
    b.visits.push({ visitId: v.id, checkedInAt: v.checkedInAt, kind: v.kind, owed: fromCents(owed) });
    out.set(v.patientId, b);
  }
  return out;
}

/** The API shape of one patient's balance (money as strings). */
export function balanceView(b: { owed: number; earlier: number; visits: { visitId: string; checkedInAt: Date; kind: string; owed: string }[] } | undefined) {
  return { owed: fromCents(b?.owed ?? 0), earlier: fromCents(b?.earlier ?? 0), visits: b?.visits ?? [] };
}

/**
 * Whether a transaction reference (Telebirr, Chapa, bank) is already on record. A reversed payment
 * frees its reference, so the money can be recorded again correctly.
 */
export async function referenceUsed(db: Db, tenantId: string, method: string, reference: string) {
  const used = await db.payment.findMany({ where: { tenantId, method: method as never, reference, amount: { gt: 0 } }, select: { id: true } });
  for (const p of used) {
    const reversed = await db.payment.findUnique({ where: { reversalOfId: p.id }, select: { id: true } });
    if (!reversed) return true;
  }
  return false;
}

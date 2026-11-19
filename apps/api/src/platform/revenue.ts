import { clinicDay } from '../common/clinic-day.js';
import { toCents } from '../common/money.js';
import type { SubState } from './subscription-state.js';

const DAY = 86_400_000;

/**
 * What a clinic brings in per month, in cents: paying clinics only (active or overdue, with a paid
 * period). A yearly plan counts as a twelfth of its price. Trials, suspended, cancelled and free
 * clinics (no end date) bring in nothing.
 */
export function monthlyCents(
  sub: { billingCycle: 'MONTHLY' | 'YEARLY'; paidUntil: Date | null; plan: { priceMonthly: { toString(): string }; priceYearly: { toString(): string } } },
  state: SubState,
) {
  if ((state !== 'active' && state !== 'overdue') || !sub.paidUntil) return 0;
  return sub.billingCycle === 'YEARLY' ? toCents(sub.plan.priceYearly) / 12 : toCents(sub.plan.priceMonthly);
}

/** The last `n` calendar months in Addis Ababa, oldest first, as YYYY-MM. */
export function lastMonths(n: number, now = new Date()) {
  const [y, m] = clinicDay(now).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** The Addis Ababa month an instant falls in, as YYYY-MM. */
export const monthOf = (at: Date) => clinicDay(at).slice(0, 7);

/** The start of an Addis Ababa month (YYYY-MM), as an instant. */
export const monthStart = (month: string) => new Date(`${month}-01T00:00:00+03:00`);

export type AgeBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

/**
 * Whole calendar days (in Addis Ababa) an invoice is past its due date: due on the 9th, it is one
 * day late on the 10th, whatever the hour it was issued.
 */
export function daysLate(dueDate: Date, now = new Date()) {
  const days = (Date.parse(clinicDay(now)) - Date.parse(clinicDay(dueDate))) / DAY;
  return Math.max(0, Math.round(days));
}

/** From when an invoice due before today counts as late: the start of today in Addis Ababa. */
export const lateBefore = (now = new Date()) => new Date(`${clinicDay(now)}T00:00:00+03:00`);

/** How late an unpaid invoice is, by its due date. */
export function ageBucket(dueDate: Date, now = new Date()): AgeBucket {
  const late = daysLate(dueDate, now);
  if (late <= 0) return 'current';
  if (late <= 30) return 'd1_30';
  if (late <= 60) return 'd31_60';
  if (late <= 90) return 'd61_90';
  return 'd90_plus';
}

const DAY = 86_400_000;

export type SubState = 'trial' | 'active' | 'overdue' | 'suspended' | 'cancelled';

export interface SubscriptionDates {
  status: 'TRIAL' | 'ACTIVE' | 'CANCELLED';
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  graceDays: number;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
}

export interface StateInfo {
  state: SubState;
  /** Records can be looked at, the bill paid, nothing else. */
  readOnly: boolean;
  /** Suspended by HMIS by hand, not by the dates. */
  manual: boolean;
  /** End of the trial or of the paid period (null: no end). */
  endsAt: Date | null;
  /** Read-only from then on, unless paid. */
  graceEndsAt: Date | null;
  /** Whole days until endsAt (trial, active) or graceEndsAt (overdue). */
  daysLeft: number | null;
}

/**
 * Where a clinic's subscription stands, from its dates: no job has to run for a clinic to become
 * overdue or read-only.
 *   trial / active → (end) → overdue: everything works, with warnings → (grace) → suspended:
 *   read-only until paid. HMIS can also suspend or cancel by hand.
 */
export function subscriptionState(s: SubscriptionDates, now = new Date()): StateInfo {
  const none = { endsAt: null, graceEndsAt: null, daysLeft: null };
  if (s.cancelledAt || s.status === 'CANCELLED') return { state: 'cancelled', readOnly: true, manual: true, ...none };
  if (s.suspendedAt) return { state: 'suspended', readOnly: true, manual: true, ...none };
  const trial = s.status === 'TRIAL';
  const endsAt = trial ? s.trialEndsAt : s.paidUntil;
  if (!endsAt) return { state: trial ? 'trial' : 'active', readOnly: false, manual: false, ...none };
  const graceEndsAt = new Date(endsAt.getTime() + s.graceDays * DAY);
  const days = (until: Date) => Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY));
  if (now < endsAt) return { state: trial ? 'trial' : 'active', readOnly: false, manual: false, endsAt, graceEndsAt, daysLeft: days(endsAt) };
  if (now < graceEndsAt) return { state: 'overdue', readOnly: false, manual: false, endsAt, graceEndsAt, daysLeft: days(graceEndsAt) };
  return { state: 'suspended', readOnly: true, manual: false, endsAt, graceEndsAt, daysLeft: 0 };
}

/** Same calendar day next month (or year); the 31st becomes the month's last day. */
export function addPeriod(from: Date, cycle: 'MONTHLY' | 'YEARLY') {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (cycle === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The optional modules a plan can include. */
export const FEATURES = {
  CREDIT: 'Credit companies and insurance',
  PURCHASE_ORDERS: 'Purchase orders',
  CLINIC_SERVER: 'Clinic server (works without internet, synced to the cloud)',
} as const;
export type Feature = keyof typeof FEATURES;

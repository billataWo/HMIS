/**
 * Family planning rules: the methods offered, when a client is next due, her current method, and
 * the couple-years of protection (CYP) each service gives. Have the clinic's midwife and the FP
 * focal person confirm the intervals and CYP factors against the Ministry of Health's guideline.
 */

type Kind =
  /** Pills and condoms: a quantity is given; pills bring her back when they run out. */
  | 'SUPPLY'
  /** An injection every 13 weeks. */
  | 'INJECTION'
  /** Implant or IUCD: inserted once, removed (or replaced) at the end of its life. */
  | 'DEVICE'
  /** Tubal ligation, vasectomy. */
  | 'PERMANENT'
  /** Emergency contraception, LAM, cycle beads. */
  | 'OTHER';

type MethodDef = {
  label: string;
  /** Who it is for: women, men, or either. */
  sex: 'FEMALE' | 'MALE' | 'ANY';
  kind: Kind;
  /** What the quantity counts (cycles, pieces, doses); none when nothing is counted. */
  unit?: string;
  /** The most that is given at once. */
  maxQuantity?: number;
  /** Pills: days one unit lasts. Injection: days to the next. Device: years it lasts. */
  days?: number;
  years?: number;
  /** Couple-years of protection: per unit for supplies, per service otherwise (USAID factors). */
  cyp: number;
  /** Condoms: given alongside her main method (dual protection), never replacing it. */
  extra?: boolean;
};

export const FP_METHODS = {
  COC: { label: 'Combined pills (COC)', sex: 'FEMALE', kind: 'SUPPLY', unit: 'cycles', maxQuantity: 13, days: 28, cyp: 1 / 15 },
  POP: { label: 'Progestin-only pills (POP)', sex: 'FEMALE', kind: 'SUPPLY', unit: 'cycles', maxQuantity: 13, days: 28, cyp: 1 / 15 },
  DMPA_IM: { label: 'Injectable, DMPA-IM (Depo)', sex: 'FEMALE', kind: 'INJECTION', days: 91, cyp: 0.25 },
  DMPA_SC: { label: 'Injectable, DMPA-SC (Sayana Press)', sex: 'FEMALE', kind: 'INJECTION', days: 91, cyp: 0.25 },
  IMPLANT_3Y: { label: 'Implant, 3 years (Implanon NXT)', sex: 'FEMALE', kind: 'DEVICE', years: 3, cyp: 2.5 },
  IMPLANT_5Y: { label: 'Implant, 5 years (Jadelle)', sex: 'FEMALE', kind: 'DEVICE', years: 5, cyp: 3.8 },
  IUCD: { label: 'IUCD (copper T)', sex: 'FEMALE', kind: 'DEVICE', years: 10, cyp: 4.6 },
  CONDOM_MALE: { label: 'Male condoms', sex: 'ANY', kind: 'SUPPLY', unit: 'pieces', maxQuantity: 500, cyp: 1 / 120, extra: true },
  CONDOM_FEMALE: { label: 'Female condoms', sex: 'FEMALE', kind: 'SUPPLY', unit: 'pieces', maxQuantity: 200, cyp: 1 / 120, extra: true },
  EC: { label: 'Emergency contraception', sex: 'FEMALE', kind: 'OTHER', unit: 'doses', maxQuantity: 5, cyp: 1 / 20 },
  TUBAL_LIGATION: { label: 'Tubal ligation', sex: 'FEMALE', kind: 'PERMANENT', cyp: 10 },
  VASECTOMY: { label: 'Vasectomy', sex: 'MALE', kind: 'PERMANENT', cyp: 10 },
  LAM: { label: 'Lactational amenorrhoea (LAM)', sex: 'FEMALE', kind: 'OTHER', cyp: 0.25 },
  SDM: { label: 'Standard days method (cycle beads)', sex: 'FEMALE', kind: 'OTHER', cyp: 1.5 },
} as const satisfies Record<string, MethodDef>;
export type FpMethod = keyof typeof FP_METHODS;
export const methodDef = (m: string): MethodDef | undefined => (FP_METHODS as Record<string, MethodDef>)[m];

/** Why an implant or IUCD came out. */
export const REMOVAL_REASONS = {
  DUE: 'Its time was up (replaced or not)',
  WANTS_PREGNANCY: 'Wants to become pregnant',
  SIDE_EFFECTS: 'Side effects',
  SWITCHING: 'Switching to another method',
  OTHER: 'Other',
} as const;
/** Why a method was stopped. */
export const STOP_REASONS = {
  WANTS_PREGNANCY: 'Wants to become pregnant',
  SIDE_EFFECTS: 'Side effects',
  MENOPAUSE: 'Menopause',
  LOST_TO_FOLLOW_UP: 'Did not come back (lost to follow-up)',
  OTHER: 'Other',
} as const;

/** Late for a resupply after this many days past its date (an injection may still be given up to 4 weeks late). */
export const FP_LATE_AFTER_DAYS = 14;
/** A device due out within this many days shows on the list. */
export const REMOVAL_WARNING_DAYS = 30;

const DAY = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const addYears = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return new Date(Date.UTC(y + n, m - 1, Math.min(d, last))).toISOString().slice(0, 10);
};

/** When she should come back after this service: pills when they run out, an injection in 13 weeks, a device at the end of its life. */
export function nextDue(method: string, givenOn: string, quantity: number | null): string | null {
  const def = methodDef(method);
  if (!def || def.extra) return null;
  if (def.kind === 'SUPPLY' && def.days && quantity) return addDays(givenOn, def.days * quantity);
  if (def.kind === 'INJECTION' && def.days) return addDays(givenOn, def.days);
  if (def.kind === 'DEVICE' && def.years) return addYears(givenOn, def.years);
  return null;
}

/** Couple-years of protection one service gives (removals and stops give none). */
export function cyp(method: string, service: string, quantity: number | null) {
  const def = methodDef(method);
  if (!def || (service !== 'START' && service !== 'RESUPPLY')) return 0;
  return def.unit ? def.cyp * (quantity ?? 0) : def.cyp;
}

export type FpEntry = { id: string; givenOn: string; createdAt: Date | string; service: string; method: string; nextDueOn: string | null };

/**
 * Her current main method (condoms aside) from her records, oldest first: the last method started
 * or resupplied, unless it was removed or stopped since. Null when she has none.
 */
export function currentMethod<T extends FpEntry>(records: T[]): (T & { since: string }) | null {
  const sorted = [...records].sort((a, b) => (a.givenOn === b.givenOn ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() : a.givenOn < b.givenOn ? -1 : 1));
  let current = null as (T & { since: string }) | null;
  for (const r of sorted) {
    if (methodDef(r.method)?.extra) continue;
    if (r.service === 'START') current = { ...r, since: r.givenOn };
    else if (r.service === 'RESUPPLY') current = { ...r, since: current?.method === r.method ? current.since : r.givenOn };
    else if ((r.service === 'REMOVAL' || r.service === 'STOP') && current?.method === r.method) current = null;
  }
  return current;
}

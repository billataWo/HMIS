/**
 * Ethiopia's routine immunization schedule (EPI), as used to work out each patient's doses: when
 * each is due, the earliest it may be given, and whether it is late. Have the EPI focal person check
 * it against the Ministry of Health's current schedule (IPV doses and HPV in particular).
 */

/** The vaccines (and vitamin A, given with them) a dose can be recorded for. */
export const VACCINES = {
  BCG: { name: 'BCG', nameAm: 'ቢሲጂ' },
  OPV: { name: 'OPV (polio drops)', nameAm: 'የፖሊዮ ጠብታ' },
  PENTA: { name: 'Pentavalent', nameAm: 'ፔንታቫለንት' },
  PCV: { name: 'PCV (pneumococcal)', nameAm: 'ፒሲቪ' },
  ROTA: { name: 'Rotavirus', nameAm: 'ሮታ' },
  IPV: { name: 'IPV (polio injection)', nameAm: 'የፖሊዮ መርፌ' },
  MCV: { name: 'Measles', nameAm: 'ኩፍኝ' },
  HPV: { name: 'HPV', nameAm: 'ኤችፒቪ' },
  TD: { name: 'Td (tetanus-diphtheria)', nameAm: 'ቲዲ' },
  VITA: { name: 'Vitamin A', nameAm: 'ቫይታሚን ኤ' },
} as const;
export type Vaccine = keyof typeof VACCINES;

type Age = { days?: number; months?: number };

export type DoseDef = {
  vaccine: Vaccine;
  doseNo: number;
  /** Where it sits on the card: "Birth", "6 weeks"… */
  milestone: string;
  /** The age it is due at. */
  due: Age;
  /** The earliest age it may be given, when earlier than `due`. */
  notBefore?: Age;
  /** At least this long after the previous dose of the same vaccine. */
  afterPrevDays?: number;
  /** Not given after this age (the window has passed). */
  maxAge?: Age;
  /** Needs the previous dose of the series first. */
  needsPrev?: boolean;
  /** Girls and women only. */
  female?: boolean;
  /** Given when the person comes, never "overdue" (Td for women, HPV). */
  flexible?: boolean;
};

const series = (vaccine: Vaccine, weeks: number[], extra: Partial<DoseDef> = {}): DoseDef[] =>
  weeks.map((w, i) => ({ vaccine, doseNo: i + 1, milestone: `${w} weeks`, due: { days: w * 7 }, ...(i > 0 && { afterPrevDays: 28, needsPrev: true }), ...extra }));

export const SCHEDULE: DoseDef[] = [
  { vaccine: 'BCG', doseNo: 1, milestone: 'Birth', due: { days: 0 }, maxAge: { months: 12 } },
  { vaccine: 'OPV', doseNo: 0, milestone: 'Birth', due: { days: 0 }, maxAge: { days: 14 } },
  ...series('OPV', [6, 10, 14]),
  ...series('PENTA', [6, 10, 14]),
  ...series('PCV', [6, 10, 14]),
  ...series('ROTA', [6, 10]),
  { vaccine: 'IPV', doseNo: 1, milestone: '14 weeks', due: { days: 98 } },
  { vaccine: 'MCV', doseNo: 1, milestone: '9 months', due: { months: 9 } },
  { vaccine: 'MCV', doseNo: 2, milestone: '15 months', due: { months: 15 }, afterPrevDays: 28, needsPrev: true },
  // Vitamin A every 6 months from 6 to 59 months.
  ...[6, 12, 18, 24, 30, 36, 42, 48, 54].map(
    (m, i): DoseDef => ({ vaccine: 'VITA', doseNo: i + 1, milestone: `${m} months`, due: { months: m }, maxAge: { months: 60 }, ...(i > 0 && { afterPrevDays: 120 }) }),
  ),
  // Girls: one dose at 14 (from 9 years on).
  { vaccine: 'HPV', doseNo: 1, milestone: '14 years (girls)', due: { months: 168 }, notBefore: { months: 108 }, female: true, flexible: true },
  // Women 15–49: five doses over their life.
  { vaccine: 'TD', doseNo: 1, milestone: 'Women 15–49', due: { months: 180 }, female: true, flexible: true },
  { vaccine: 'TD', doseNo: 2, milestone: 'Women 15–49', due: { months: 180 }, afterPrevDays: 28, needsPrev: true, female: true, flexible: true },
  { vaccine: 'TD', doseNo: 3, milestone: 'Women 15–49', due: { months: 180 }, afterPrevDays: 182, needsPrev: true, female: true, flexible: true },
  { vaccine: 'TD', doseNo: 4, milestone: 'Women 15–49', due: { months: 180 }, afterPrevDays: 365, needsPrev: true, female: true, flexible: true },
  { vaccine: 'TD', doseNo: 5, milestone: 'Women 15–49', due: { months: 180 }, afterPrevDays: 365, needsPrev: true, female: true, flexible: true },
];

/** The childhood vaccines whose late doses put a child on the defaulter list. */
export const TRACED: Vaccine[] = ['BCG', 'OPV', 'PENTA', 'PCV', 'ROTA', 'IPV', 'MCV'];

/** All of these before the first birthday = fully immunized. */
export const FULLY_IMMUNIZED: [Vaccine, number][] = [
  ['BCG', 1],
  ['PENTA', 1], ['PENTA', 2], ['PENTA', 3],
  ['OPV', 1], ['OPV', 2], ['OPV', 3],
  ['PCV', 1], ['PCV', 2], ['PCV', 3],
  ['ROTA', 1], ['ROTA', 2],
  ['IPV', 1],
  ['MCV', 1],
];

/** A dose late by more than this is overdue (a defaulter). */
export const OVERDUE_AFTER_DAYS = 14;

export function doseLabel(vaccine: Vaccine, doseNo: number) {
  const short: Record<Vaccine, string> = { BCG: 'BCG', OPV: 'OPV', PENTA: 'Penta', PCV: 'PCV', ROTA: 'Rota', IPV: 'IPV', MCV: 'Measles', HPV: 'HPV', TD: 'Td', VITA: 'Vitamin A' };
  return vaccine === 'BCG' || vaccine === 'HPV' ? short[vaccine] : `${short[vaccine]} ${doseNo}`;
}

export const findDose = (vaccine: string, doseNo: number) => SCHEDULE.find((d) => d.vaccine === vaccine && d.doseNo === doseNo);

// ---- dates as YYYY-MM-DD clinic days ----
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}
const plus = (day: string, age: Age) => addDays(addMonths(day, age.months ?? 0), age.days ?? 0);
const later = (a: string, b: string | null) => (b && b > a ? b : a);

export type Given = { id: string; vaccine: string; doseNo: number; givenOn: string };
export type DoseStatus = 'GIVEN' | 'UPCOMING' | 'DUE' | 'OVERDUE' | 'MISSED';
export type ScheduledDose = {
  vaccine: Vaccine;
  doseNo: number;
  label: string;
  milestone: string;
  status: DoseStatus;
  dueOn: string;
  notBefore: string;
  /** The previous dose of the series is still to be given. */
  waitingFor: string | null;
  given: Given | null;
};

/**
 * The doses that apply to this person, with their state on `today`: children under 5 their
 * childhood vaccines and vitamin A, girls 9–18 HPV, women 15–49 Td; and any vaccine already
 * recorded for them, whatever their age. `include` adds a vaccine whatever the age (to check a dose
 * about to be given).
 */
export function scheduleFor(p: { dob: string; sex: 'MALE' | 'FEMALE' }, given: Given[], today: string, include?: Vaccine): ScheduledDose[] {
  const ageMonths = (() => {
    const [y1, m1, d1] = p.dob.split('-').map(Number);
    const [y2, m2, d2] = today.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  })();
  const has = (v: Vaccine) => given.some((g) => g.vaccine === v);
  const applies = (d: DoseDef) => {
    if (d.female && p.sex !== 'FEMALE') return false;
    if (has(d.vaccine) || d.vaccine === include) return true;
    if (d.vaccine === 'HPV') return ageMonths >= 108 && ageMonths < 216;
    if (d.vaccine === 'TD') return ageMonths >= 180 && ageMonths < 600;
    return ageMonths < 60;
  };
  const out: (ScheduledDose & { at: string })[] = [];
  for (const d of SCHEDULE.filter(applies)) {
    const g = given.find((x) => x.vaccine === d.vaccine && x.doseNo === d.doseNo) ?? null;
    const prevDef = SCHEDULE.find((x) => x.vaccine === d.vaccine && x.doseNo === d.doseNo - 1 && x.doseNo > 0);
    const prev = prevDef ? given.find((x) => x.vaccine === d.vaccine && x.doseNo === prevDef.doseNo) : undefined;
    const fromPrev = prev && d.afterPrevDays ? addDays(prev.givenOn, d.afterPrevDays) : null;
    const dueOn = later(plus(p.dob, d.due), fromPrev);
    const notBefore = later(plus(p.dob, d.notBefore ?? d.due), fromPrev);
    const waitingFor = d.needsPrev && prevDef && !prev ? doseLabel(d.vaccine, prevDef.doseNo) : null;
    let status: DoseStatus;
    if (g) status = 'GIVEN';
    else if (d.maxAge && today >= plus(p.dob, d.maxAge)) status = 'MISSED';
    else if (dueOn > today) status = 'UPCOMING';
    else if (d.flexible || addDays(dueOn, OVERDUE_AFTER_DAYS) > today) status = 'DUE';
    else status = 'OVERDUE';
    out.push({ at: plus(p.dob, d.due), vaccine: d.vaccine, doseNo: d.doseNo, label: doseLabel(d.vaccine, d.doseNo), milestone: d.milestone, status, dueOn, notBefore, waitingFor, given: g });
  }
  // By the age each dose belongs to, so one visit's vaccines sit together (the sort keeps the schedule's order within an age).
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(({ at: _, ...d }) => d);
}

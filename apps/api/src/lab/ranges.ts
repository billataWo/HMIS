/**
 * Reference and critical ranges. A test (or panel component) has a default range; it may also
 * have ranges for men, women and age groups. The range that fits the patient most closely wins:
 * one for their sex beats one for both, and a narrower age group beats a wider one. A range that
 * leaves a limit empty takes it from the default (so critical limits can be set once).
 */

type Num = { toString(): string } | null;
export interface BaseRange {
  unit: string | null;
  refLow: Num;
  refHigh: Num;
  critLow: Num;
  critHigh: Num;
}
export interface BandRange {
  sex: 'MALE' | 'FEMALE' | null;
  ageFromDays: number;
  ageToDays: number | null;
  refLow: Num;
  refHigh: Num;
  critLow: Num;
  critHigh: Num;
}
export interface Patient {
  sex: 'MALE' | 'FEMALE';
  dateOfBirth: Date | string | null;
}
export interface Applied {
  refLow: number | null;
  refHigh: number | null;
  critLow: number | null;
  critHigh: number | null;
  /** Who the range is for, when it is not the default: "men", "children 1–12 years". */
  who: string | null;
}

const DAY = 86_400_000;
const n = (x: Num) => (x === null || x === undefined ? null : Number(x));

/** Age in whole days at `at`, or null when the date of birth is unknown. */
export function ageDays(dob: Date | string | null, at: Date) {
  if (!dob) return null;
  return Math.floor((at.getTime() - new Date(dob).getTime()) / DAY);
}

/** "men", "women", "age 1–12 y", "female, age 12 y+": who a range is for, as printed. */
export function bandLabel(r: Pick<BandRange, 'sex' | 'ageFromDays' | 'ageToDays'>) {
  const anyAge = r.ageFromDays === 0 && r.ageToDays === null;
  if (anyAge) return r.sex === 'MALE' ? 'men' : r.sex === 'FEMALE' ? 'women' : null;
  const age = (d: number) => (d % 365 === 0 ? `${d / 365} y` : d % 30 === 0 ? `${d / 30} mo` : `${d} d`);
  const span = `age ${r.ageToDays === null ? `${age(r.ageFromDays)}+` : `${age(r.ageFromDays)}–${age(r.ageToDays)}`}`;
  return r.sex ? `${r.sex === 'MALE' ? 'male' : 'female'}, ${span}` : span;
}

/** The range for this patient (see the file comment for how one is chosen). */
export function pickRange(base: BaseRange, ranges: BandRange[], patient: Patient | null, at = new Date()): Applied {
  const age = patient ? ageDays(patient.dateOfBirth, at) : null;
  const fits = ranges.filter((r) => {
    if (r.sex && r.sex !== patient?.sex) return false;
    // Unknown age: only ranges for every age can apply.
    if (age === null) return r.ageFromDays === 0 && r.ageToDays === null;
    return age >= r.ageFromDays && (r.ageToDays === null || age < r.ageToDays);
  });
  const width = (r: BandRange) => (r.ageToDays ?? 200 * 365) - r.ageFromDays;
  const best = fits.sort((a, b) => Number(!!b.sex) - Number(!!a.sex) || width(a) - width(b))[0];
  const pick = (k: 'refLow' | 'refHigh' | 'critLow' | 'critHigh') => n(best?.[k] ?? null) ?? n(base[k]);
  return { refLow: pick('refLow'), refHigh: pick('refHigh'), critLow: pick('critLow'), critHigh: pick('critHigh'), who: best ? bandLabel(best) : null };
}

/** LL / L / N / H / HH: double letters are beyond a critical limit. */
export function flagValue(value: number, r: Applied) {
  if (r.critLow !== null && value < r.critLow) return 'LL';
  if (r.critHigh !== null && value > r.critHigh) return 'HH';
  if (r.refLow !== null && value < r.refLow) return 'L';
  if (r.refHigh !== null && value > r.refHigh) return 'H';
  return 'N';
}

export const isCritical = (flag: string | null | undefined) => flag === 'LL' || flag === 'HH';
export const isAbnormal = (flag: string | null | undefined) => !!flag && flag !== 'N';

/** "13–17 g/dL (men)", "< 5 /hpf", or null when there is no range. */
export function rangeText(r: Applied, unit: string | null) {
  const f = (x: number) => String(Number(x.toFixed(3)));
  const span =
    r.refLow !== null && r.refHigh !== null ? `${f(r.refLow)}–${f(r.refHigh)}` : r.refLow !== null ? `≥ ${f(r.refLow)}` : r.refHigh !== null ? `≤ ${f(r.refHigh)}` : null;
  if (!span) return null;
  return `${span}${unit ? ` ${unit}` : ''}${r.who ? ` (${r.who})` : ''}`;
}

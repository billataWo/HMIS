/**
 * Reference and critical ranges, to flag a result entered offline the way the server will (the
 * same rules as apps/api/src/lab/ranges.ts: the range for the patient's sex and age wins over the
 * test's default; a range that leaves a limit empty takes the default's). The server checks again
 * when the result is sent; this is so the lab sees a critical result straight away and records
 * who was told before releasing it.
 */
import type { LabFlag, LabRange, QueuePatient } from "@/lib/api";

type Num = string | number | null | undefined;
export type Checkable = { name: string; unit: string | null; refLow: Num; refHigh: Num; critLow?: Num; critHigh?: Num; resultOptions: string[]; ranges?: LabRange[] };
type Applied = { refLow: number | null; refHigh: number | null; critLow: number | null; critHigh: number | null; who: string | null };

const DAY = 86_400_000;
const n = (x: Num) => (x === null || x === undefined || x === "" ? null : Number(x));

function bandLabel(r: Pick<LabRange, "sex" | "ageFromDays" | "ageToDays">) {
  const anyAge = r.ageFromDays === 0 && r.ageToDays === null;
  if (anyAge) return r.sex === "MALE" ? "men" : r.sex === "FEMALE" ? "women" : null;
  const age = (d: number) => (d % 365 === 0 ? `${d / 365} y` : d % 30 === 0 ? `${d / 30} mo` : `${d} d`);
  const span = `age ${r.ageToDays === null ? `${age(r.ageFromDays)}+` : `${age(r.ageFromDays)}–${age(r.ageToDays)}`}`;
  return r.sex ? `${r.sex === "MALE" ? "male" : "female"}, ${span}` : span;
}

function pickRange(c: Checkable, patient: Pick<QueuePatient, "sex" | "dateOfBirth"> | null, at: Date): Applied {
  const age = patient?.dateOfBirth ? Math.floor((at.getTime() - new Date(patient.dateOfBirth).getTime()) / DAY) : null;
  const fits = (c.ranges ?? []).filter((r) => {
    if (r.sex && r.sex !== patient?.sex) return false;
    if (age === null) return r.ageFromDays === 0 && r.ageToDays === null;
    return age >= r.ageFromDays && (r.ageToDays === null || age < r.ageToDays);
  });
  const width = (r: LabRange) => (r.ageToDays ?? 200 * 365) - r.ageFromDays;
  const best = fits.sort((a, b) => Number(!!b.sex) - Number(!!a.sex) || width(a) - width(b))[0];
  const pick = (k: "refLow" | "refHigh" | "critLow" | "critHigh") => n(best?.[k]) ?? n(c[k]);
  return { refLow: pick("refLow"), refHigh: pick("refHigh"), critLow: pick("critLow"), critHigh: pick("critHigh"), who: best ? bandLabel(best) : null };
}

function rangeText(r: Applied, unit: string | null) {
  const f = (x: number) => String(Number(x.toFixed(3)));
  const span =
    r.refLow !== null && r.refHigh !== null ? `${f(r.refLow)}–${f(r.refHigh)}` : r.refLow !== null ? `≥ ${f(r.refLow)}` : r.refHigh !== null ? `≤ ${f(r.refHigh)}` : null;
  if (!span) return null;
  return `${span}${unit ? ` ${unit}` : ""}${r.who ? ` (${r.who})` : ""}`;
}

/**
 * The flag (LL, L, N, H, HH) and printed range of one value, or an error to show (not one of the
 * answers, not a number). Blank values and tests without a range get no flag.
 */
export function checkResult(
  c: Checkable,
  value: string,
  patient: Pick<QueuePatient, "sex" | "dateOfBirth"> | null,
  at = new Date(),
): { flag: LabFlag | null; rangeText: string | null; error?: "choose" | "number" } {
  if (!value.trim()) return { flag: null, rangeText: null };
  if (c.resultOptions.length) return c.resultOptions.includes(value) ? { flag: null, rangeText: null } : { flag: null, rangeText: null, error: "choose" };
  const r = pickRange(c, patient, at);
  if (r.refLow === null && r.refHigh === null && r.critLow === null && r.critHigh === null) return { flag: null, rangeText: null };
  const v = Number(value.replace(",", "."));
  if (!Number.isFinite(v)) return { flag: null, rangeText: null, error: "number" };
  const flag: LabFlag =
    r.critLow !== null && v < r.critLow ? "LL" : r.critHigh !== null && v > r.critHigh ? "HH" : r.refLow !== null && v < r.refLow ? "L" : r.refHigh !== null && v > r.refHigh ? "H" : "N";
  return { flag, rangeText: rangeText(r, c.unit) };
}

export const isCritical = (flag: string | null | undefined) => flag === "LL" || flag === "HH";

/** The worst flag of a panel: critical, then abnormal, then normal. */
export function worstFlag(flags: (string | null)[]): LabFlag | null {
  for (const f of ["HH", "LL", "H", "L", "N"] as const) if (flags.includes(f)) return f;
  return null;
}

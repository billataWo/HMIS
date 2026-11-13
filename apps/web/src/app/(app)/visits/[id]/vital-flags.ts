/**
 * Vital signs outside the usual range for the patient's age, to catch the eye while the form is
 * filled in. Adults: common cut-offs in the spirit of early-warning scores. Children: age bands
 * (WHO IMCI fast breathing; usual paediatric pulse ranges; low blood pressure below 70 + 2 × age).
 * "Urgent" are the values that usually need prompt attention. A flag is a prompt to look again,
 * never a diagnosis; have the clinical advisor review the cut-offs.
 */
export type VitalFlag = { text: string; urgent: boolean };

type Rule = { test: (v: number) => boolean; text: string; urgent?: boolean };

/** Who the vitals are for: age in months (null if unknown), and a pregnant or breastfeeding woman. */
export type VitalContext = { ageMonths: number | null; mother?: boolean };

const ADULT: Record<string, Rule[]> = {
  temperatureC: [
    { test: (v) => v >= 39.5, text: "High fever", urgent: true },
    { test: (v) => v >= 38, text: "Fever" },
    { test: (v) => v <= 35, text: "Low temperature", urgent: true },
  ],
  pulse: [
    { test: (v) => v >= 130, text: "Very fast pulse", urgent: true },
    { test: (v) => v > 100, text: "Fast pulse" },
    { test: (v) => v < 40, text: "Very slow pulse", urgent: true },
    { test: (v) => v < 50, text: "Slow pulse" },
  ],
  systolicBp: [
    { test: (v) => v >= 180, text: "Very high", urgent: true },
    { test: (v) => v >= 140, text: "High" },
    { test: (v) => v < 90, text: "Low", urgent: true },
  ],
  diastolicBp: [
    { test: (v) => v >= 120, text: "Very high", urgent: true },
    { test: (v) => v >= 90, text: "High" },
    { test: (v) => v < 60, text: "Low" },
  ],
  respRate: [
    { test: (v) => v >= 30, text: "Very fast breathing", urgent: true },
    { test: (v) => v > 20, text: "Fast breathing" },
    { test: (v) => v < 10, text: "Slow breathing", urgent: true },
  ],
  spo2: [
    { test: (v) => v < 90, text: "Low oxygen", urgent: true },
    { test: (v) => v < 94, text: "Below normal" },
  ],
};

/** A child's usual pulse range, by age in months: [low, high, urgently high]. */
function childPulse(m: number): [number, number, number] {
  if (m < 12) return [100, 160, 180];
  if (m < 60) return [80, 140, 160];
  if (m < 144) return [70, 120, 140];
  return [60, 100, 130];
}

/** WHO IMCI fast breathing, by age in months. */
function fastBreathing(m: number) {
  return m < 2 ? 60 : m < 12 ? 50 : m < 60 ? 40 : m < 144 ? 30 : 20;
}

function childRules(m: number): Record<string, Rule[]> {
  const [low, high, veryHigh] = childPulse(m);
  const fast = fastBreathing(m);
  const years = Math.floor(m / 12);
  // Low blood pressure in children: below 70 + 2 × age in years (1–10), 60 under a year, 90 from 10.
  const lowSys = m < 12 ? 60 : years < 10 ? 70 + 2 * years : 90;
  return {
    temperatureC: [
      // A fever in a baby under 3 months is always urgent.
      { test: (v) => v >= 38 && m < 3, text: "Fever in a young baby", urgent: true },
      { test: (v) => v >= 39.5, text: "High fever", urgent: true },
      { test: (v) => v >= 38, text: "Fever" },
      { test: (v) => v < 35.5, text: "Low temperature", urgent: true },
    ],
    pulse: [
      { test: (v) => v >= veryHigh, text: "Very fast pulse for the age", urgent: true },
      { test: (v) => v > high, text: "Fast pulse for the age" },
      { test: (v) => v < low - 20, text: "Very slow pulse for the age", urgent: true },
      { test: (v) => v < low, text: "Slow pulse for the age" },
    ],
    systolicBp: [{ test: (v) => v < lowSys, text: "Low for the age", urgent: true }],
    respRate: [
      // Fast breathing under 2 months is a danger sign (IMCI).
      { test: (v) => v >= fast && m < 2, text: "Fast breathing: a danger sign at this age", urgent: true },
      { test: (v) => v >= fast + 10, text: "Very fast breathing for the age", urgent: true },
      { test: (v) => v >= fast, text: "Fast breathing for the age" },
    ],
    spo2: ADULT.spo2,
  };
}

/** MUAC (mm): children 6–59 months (WHO), pregnant and breastfeeding women. */
function muacRules(ctx: VitalContext): Rule[] {
  if (ctx.ageMonths !== null && ctx.ageMonths >= 6 && ctx.ageMonths < 60) {
    return [
      { test: (v) => v < 115, text: "Severe acute malnutrition", urgent: true },
      { test: (v) => v < 125, text: "Moderate acute malnutrition" },
    ];
  }
  if (ctx.mother) return [{ test: (v) => v < 230, text: "Undernourished (pregnant or breastfeeding)" }];
  return [];
}

/** Whether the vitals are a child's (under 18), judged by age bands. */
export const isChild = (ctx: VitalContext) => ctx.ageMonths !== null && ctx.ageMonths < 216;

export function vitalFlag(field: string, raw: string, ctx: VitalContext = { ageMonths: null }): VitalFlag | null {
  const v = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(v)) return null;
  // Age unknown: no age-dependent flags (an adult's limits could be wrong for a child), except oxygen and MUAC.
  const rules =
    field === "muacMm" ? muacRules(ctx) : ctx.ageMonths === null ? (field === "spo2" ? ADULT.spo2 : []) : isChild(ctx) ? childRules(ctx.ageMonths)[field] : ADULT[field];
  const rule = rules?.find((r) => r.test(v));
  return rule ? { text: rule.text, urgent: !!rule.urgent } : null;
}

/** BMI for adults: under 16 is severe thinness. */
export function bmiFlag(bmi: number): VitalFlag | null {
  if (bmi < 16) return { text: "Severe thinness", urgent: true };
  if (bmi < 18.5) return { text: "Underweight", urgent: false };
  if (bmi >= 30) return { text: "Obese", urgent: false };
  if (bmi >= 25) return { text: "Overweight", urgent: false };
  return null;
}

export type TriageLevel = "RED" | "ORANGE" | "YELLOW" | "GREEN";

export const TRIAGE: Record<TriageLevel, { label: string; hint: string; tone: string }> = {
  RED: { label: "Emergency", hint: "See now", tone: "bg-red-600 text-white" },
  ORANGE: { label: "Very urgent", hint: "Within 10 minutes", tone: "bg-orange-500 text-white" },
  YELLOW: { label: "Urgent", hint: "Within an hour", tone: "bg-yellow-400 text-yellow-950" },
  GREEN: { label: "Routine", hint: "In turn", tone: "bg-emerald-600 text-white" },
};

/**
 * A suggested triage level from the vitals: low oxygen or low blood pressure is an emergency, any
 * other urgent flag very urgent, any other flag urgent. The nurse decides; the suggestion only
 * makes sure danger signs are not missed.
 */
export function suggestTriage(values: Record<string, string>, ctx: VitalContext): { level: TriageLevel; because: string | null } {
  const flags = Object.entries(values)
    .map(([k, v]) => ({ field: k, flag: vitalFlag(k, v, ctx) }))
    .filter((f): f is { field: string; flag: VitalFlag } => !!f.flag);
  const emergency = flags.find((f) => f.flag.urgent && (f.field === "spo2" || f.field === "systolicBp"));
  if (emergency) return { level: "RED", because: emergency.flag.text };
  const urgent = flags.find((f) => f.flag.urgent);
  if (urgent) return { level: "ORANGE", because: urgent.flag.text };
  if (flags.length) return { level: "YELLOW", because: flags[0].flag.text };
  return { level: "GREEN", because: null };
}

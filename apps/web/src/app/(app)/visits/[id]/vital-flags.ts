/**
 * Out-of-range vital signs for an ADULT, to catch the eye while the form is filled in. Common adult
 * cut-offs (in the spirit of early-warning scores); "urgent" are the values that usually need
 * prompt attention. Not applied to children: their normal ranges depend on age. A flag is a
 * prompt to look again, never a diagnosis.
 */
export type VitalFlag = { text: string; urgent: boolean };

type Rule = { test: (v: number) => boolean; text: string; urgent?: boolean };

const RULES: Record<string, Rule[]> = {
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

export function vitalFlag(field: string, raw: string): VitalFlag | null {
  const v = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(v)) return null;
  const rule = RULES[field]?.find((r) => r.test(v));
  return rule ? { text: rule.text, urgent: !!rule.urgent } : null;
}

/**
 * Antenatal care rules: gestational age and due date from the last period, the WHO 8-contact
 * schedule Ethiopia adopted, and the warnings a contact's findings raise. Have the clinic's
 * midwife or obstetrician confirm the cut-offs before go-live.
 */

/** The weeks of pregnancy the eight contacts fall at (the first up to 12 weeks). */
export const CONTACT_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40];

/** Late for the next contact after this many days past its date. */
export const ANC_LATE_AFTER_DAYS = 7;

export const DANGER_SIGNS = {
  BLEEDING: 'Vaginal bleeding',
  HEADACHE: 'Severe headache or blurred vision',
  CONVULSIONS: 'Fits (convulsions)',
  ABDOMINAL_PAIN: 'Severe abdominal pain',
  FEVER: 'Fever',
  BREATHING: 'Difficulty breathing',
  REDUCED_MOVEMENT: 'Baby moving less or not at all',
  WATERS_BROKE: 'Leaking fluid (waters broken)',
  SWELLING: 'Swelling of the face or hands',
} as const;
export type DangerSign = keyof typeof DANGER_SIGNS;

export const RISK_FACTORS = {
  AGE_UNDER_18: 'Under 18 years old',
  AGE_35_PLUS: '35 years or older',
  GRAND_MULTIPARA: 'Five or more previous births',
  PREVIOUS_CAESAREAN: 'Previous caesarean section',
  PREVIOUS_STILLBIRTH: 'Previous stillbirth or newborn death',
  PREVIOUS_PPH: 'Previous heavy bleeding after birth',
  PREVIOUS_PREECLAMPSIA: 'Previous pre-eclampsia or eclampsia',
  HYPERTENSION: 'Chronic hypertension',
  DIABETES: 'Diabetes',
  HIV: 'HIV positive',
  MULTIPLE: 'Twins or more',
  SHORT_STATURE: 'Height under 150 cm',
} as const;
export type RiskFactor = keyof typeof RISK_FACTORS;

export const TEST_RESULTS = ['NEGATIVE', 'POSITIVE', 'NOT_DONE'] as const;
export const URINE_PROTEIN = ['NEGATIVE', 'TRACE', 'PLUS1', 'PLUS2', 'PLUS3'] as const;

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Gestational age on `on` from the last period: whole weeks and the days beyond. */
export function gestation(lmp: string, on: string) {
  const d = days(lmp, on);
  return { weeks: Math.floor(d / 7), days: d % 7, totalDays: d };
}

/** The expected date of delivery: 280 days after the last period (Naegele). */
export const eddFrom = (lmp: string) => addDays(lmp, 280);

/** The last period that gives this due date (when the due date is known from an ultrasound). */
export const lmpFromEdd = (edd: string) => addDays(edd, -280);

/**
 * The next contact's date after a contact at `weeks` of pregnancy: the next week of the schedule
 * (a week on after 40, until delivery).
 */
export function nextContactOn(lmp: string, weeks: number) {
  // The first contact is "up to 12 weeks": one before then is that contact, so the next is at 20.
  const next = CONTACT_WEEKS.slice(1).find((w) => w > weeks) ?? weeks + 1;
  return addDays(lmp, next * 7);
}

export type Findings = {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  urineProtein?: (typeof URINE_PROTEIN)[number] | null;
  hb?: number | null;
  fetalHeartRate?: number | null;
  gaWeeks: number;
  dangerSigns?: string[];
  syphilis?: (typeof TEST_RESULTS)[number] | null;
  hiv?: (typeof TEST_RESULTS)[number] | null;
  hbsag?: (typeof TEST_RESULTS)[number] | null;
};

export type AncAlert = { level: 'URGENT' | 'WARNING'; text: string };

/**
 * What a contact's findings call for: urgent ones mean referral or treatment today, warnings a
 * closer look. A prompt to act, never a diagnosis.
 */
export function ancAlerts(f: Findings): AncAlert[] {
  const out: AncAlert[] = [];
  const sys = f.systolicBp ?? 0;
  const dia = f.diastolicBp ?? 0;
  const protein = f.urineProtein && ['PLUS1', 'PLUS2', 'PLUS3'].includes(f.urineProtein);
  if (sys >= 160 || dia >= 110) out.push({ level: 'URGENT', text: 'Severe high blood pressure: treat and refer today' });
  else if ((sys >= 140 || dia >= 90) && protein && f.gaWeeks >= 20) out.push({ level: 'URGENT', text: 'High blood pressure with protein in the urine: pre-eclampsia, refer today' });
  else if (sys >= 140 || dia >= 90) out.push({ level: 'WARNING', text: 'High blood pressure: recheck, test the urine for protein' });
  if (f.hb != null && f.hb < 7) out.push({ level: 'URGENT', text: 'Severe anaemia (Hb under 7): refer' });
  else if (f.hb != null && f.hb < 11) out.push({ level: 'WARNING', text: 'Anaemia (Hb under 11): iron-folic acid twice a day, recheck' });
  if (f.fetalHeartRate != null && f.gaWeeks >= 20 && (f.fetalHeartRate < 110 || f.fetalHeartRate > 160)) {
    out.push({ level: 'URGENT', text: 'Fetal heart rate outside 110–160: assess and refer' });
  }
  if (f.dangerSigns?.length) out.push({ level: 'URGENT', text: `Danger sign${f.dangerSigns.length > 1 ? 's' : ''}: ${f.dangerSigns.map((d) => DANGER_SIGNS[d as DangerSign] ?? d).join(', ')}. Assess now and refer` });
  if (f.syphilis === 'POSITIVE') out.push({ level: 'URGENT', text: 'Syphilis positive: treat her (benzathine penicillin) and her partner' });
  if (f.hiv === 'POSITIVE') out.push({ level: 'URGENT', text: 'HIV positive: start ART and plan to prevent transmission to the baby' });
  if (f.hbsag === 'POSITIVE') out.push({ level: 'WARNING', text: 'Hepatitis B positive: the baby needs the birth-dose vaccine' });
  if (f.gaWeeks >= 41) out.push({ level: 'URGENT', text: '41 weeks or more: past term, refer for delivery' });
  return out;
}

/** Risk factors that follow from her age and history, added to those ticked by hand. */
export function derivedRisks(age: number | null, para: number): RiskFactor[] {
  const out: RiskFactor[] = [];
  if (age !== null && age < 18) out.push('AGE_UNDER_18');
  if (age !== null && age >= 35) out.push('AGE_35_PLUS');
  if (para >= 5) out.push('GRAND_MULTIPARA');
  return out;
}

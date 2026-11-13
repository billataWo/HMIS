/**
 * Prescribing safety checks: allergies, interactions, duplicates, pregnancy and breastfeeding.
 *
 * The interaction list holds well-established, clinically important pairs for the medicines
 * Ethiopian clinics commonly stock (the starter formulary). It is not a full interaction
 * database: have the clinical advisor review it and extend it for the facility's formulary.
 */

export interface DrugLike {
  id: string;
  genericName: string;
  brandName?: string | null;
  drugClass?: string | null;
  /** Shown after the name in alerts, e.g. "taking since 2 Nov" for a current medicine. */
  note?: string;
}

const label = (d: DrugLike) => (d.note ? `${d.genericName} (${d.note})` : d.genericName);

/** " chloroquine phosphate " → whole-word phrase search, so "chloroquine" matches it. */
const padded = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim()} `;

/** Whether the drug's class, generic name or brand name contains the term as whole words. */
function has(d: DrugLike, term: string) {
  const t = padded(term);
  return [d.drugClass, d.genericName, d.brandName].some((x) => !!x && padded(x).includes(t));
}

export interface Alert {
  type: 'ALLERGY' | 'INTERACTION' | 'DUPLICATE' | 'PREGNANCY' | 'BREASTFEEDING';
  severity: 'BLOCK' | 'MAJOR' | 'MODERATE';
  message: string;
  drugIds: string[];
}

/** Common ways allergies are written on patient cards, mapped to the drug class they mean. */
const ALLERGY_ALIASES: Record<string, string> = {
  penicillin: 'penicillin',
  penicillins: 'penicillin',
  sulfa: 'sulfonamide',
  sulpha: 'sulfonamide',
  sulfonamide: 'sulfonamide',
  sulphonamide: 'sulfonamide',
  'sulfa drugs': 'sulfonamide',
  nsaid: 'nsaid',
  nsaids: 'nsaid',
  aspirin: 'nsaid',
  cephalosporin: 'cephalosporin',
  cephalosporins: 'cephalosporin',
  quinolone: 'fluoroquinolone',
  fluoroquinolone: 'fluoroquinolone',
};

const norm = (s: string) => s.trim().toLowerCase();

function tokens(d: DrugLike) {
  return [d.genericName, d.brandName, d.drugClass].filter((x): x is string => !!x).map(norm);
}

export function allergyAlerts(allergies: string[], drugs: DrugLike[]): Alert[] {
  const alerts: Alert[] = [];
  for (const raw of allergies) {
    const allergy = norm(raw);
    if (!allergy) continue;
    const asClass = ALLERGY_ALIASES[allergy];
    for (const d of drugs) {
      const t = tokens(d);
      const hit =
        (asClass && norm(d.drugClass ?? '') === asClass) ||
        t.some((x) => x === allergy || x.includes(allergy) || (allergy.length >= 5 && allergy.includes(x)));
      if (hit) {
        alerts.push({
          type: 'ALLERGY',
          severity: 'BLOCK',
          message: `Patient is allergic to ${raw}: ${d.genericName}${d.drugClass ? ` (${d.drugClass})` : ''}`,
          drugIds: [d.id],
        });
      }
    }
  }
  return alerts;
}

/**
 * Each side lists drug classes (as the formulary writes them) or generic names; a drug matches
 * when its class, generic or brand name contains the term as whole words.
 */
export const INTERACTIONS: { a: string[]; b: string[]; severity: 'MAJOR' | 'MODERATE'; effect: string }[] = [
  // Bleeding
  { a: ['warfarin'], b: ['nsaid'], severity: 'MAJOR', effect: 'higher risk of serious bleeding' },
  { a: ['warfarin'], b: ['metronidazole', 'ciprofloxacin', 'fluconazole', 'cotrimoxazole', 'erythromycin', 'clarithromycin'], severity: 'MAJOR', effect: 'raises INR; bleeding risk' },
  { a: ['warfarin'], b: ['rifampicin', 'carbamazepine', 'phenobarbital', 'phenytoin'], severity: 'MAJOR', effect: 'lowers INR; risk of clots' },
  { a: ['ssri'], b: ['nsaid', 'warfarin', 'clopidogrel'], severity: 'MODERATE', effect: 'higher risk of bleeding, especially from the stomach' },
  { a: ['nsaid'], b: ['corticosteroid'], severity: 'MODERATE', effect: 'higher risk of stomach ulcers and bleeding' },
  { a: ['clopidogrel'], b: ['omeprazole'], severity: 'MODERATE', effect: 'reduced antiplatelet effect' },
  // Kidneys, potassium, blood pressure
  { a: ['ace-inhibitor'], b: ['spironolactone', 'potassium chloride'], severity: 'MAJOR', effect: 'risk of dangerous hyperkalaemia' },
  { a: ['spironolactone'], b: ['potassium chloride'], severity: 'MAJOR', effect: 'risk of dangerous hyperkalaemia' },
  { a: ['ace-inhibitor'], b: ['nsaid'], severity: 'MODERATE', effect: 'reduced blood-pressure control and risk of kidney injury' },
  { a: ['ace-inhibitor'], b: ['cotrimoxazole'], severity: 'MODERATE', effect: 'trimethoprim raises potassium; check it' },
  { a: ['nsaid'], b: ['loop diuretic', 'thiazide'], severity: 'MODERATE', effect: 'weaker diuretic effect and risk of kidney injury' },
  { a: ['lithium'], b: ['nsaid', 'thiazide', 'loop diuretic', 'ace-inhibitor'], severity: 'MAJOR', effect: 'lithium toxicity' },
  { a: ['digoxin'], b: ['loop diuretic', 'thiazide'], severity: 'MODERATE', effect: 'low potassium makes digoxin toxicity more likely' },
  { a: ['digoxin'], b: ['amiodarone', 'erythromycin', 'clarithromycin'], severity: 'MAJOR', effect: 'digoxin toxicity' },
  { a: ['gentamicin', 'aminoglycoside'], b: ['loop diuretic'], severity: 'MODERATE', effect: 'more risk of hearing and kidney damage' },
  { a: ['verapamil', 'diltiazem'], b: ['beta-blocker'], severity: 'MAJOR', effect: 'slow heart rate, heart block and heart failure' },
  { a: ['sildenafil', 'tadalafil'], b: ['nitrate', 'isosorbide', 'glyceryl trinitrate'], severity: 'MAJOR', effect: 'severe hypotension' },
  // Sedation, breathing, serotonin
  { a: ['opioid', 'tramadol'], b: ['benzodiazepine'], severity: 'MAJOR', effect: 'deep sedation and slowed breathing' },
  { a: ['tramadol'], b: ['ssri', 'tricyclic antidepressant'], severity: 'MAJOR', effect: 'serotonin syndrome and seizures' },
  { a: ['tricyclic antidepressant'], b: ['ssri'], severity: 'MAJOR', effect: 'higher antidepressant levels and serotonin syndrome' },
  { a: ['antihistamine'], b: ['opioid', 'benzodiazepine'], severity: 'MODERATE', effect: 'added drowsiness' },
  { a: ['metoclopramide'], b: ['haloperidol', 'chlorpromazine'], severity: 'MODERATE', effect: 'movement side effects (extrapyramidal)' },
  // Blood sugar
  { a: ['sulfonylurea', 'glibenclamide'], b: ['fluconazole', 'cotrimoxazole'], severity: 'MAJOR', effect: 'risk of severe low blood sugar' },
  { a: ['sulfonylurea', 'insulin'], b: ['beta-blocker'], severity: 'MODERATE', effect: 'the warning signs of low blood sugar can be hidden' },
  { a: ['sulfonylurea', 'insulin', 'biguanide'], b: ['corticosteroid'], severity: 'MODERATE', effect: 'raises blood sugar; check it more often' },
  // Absorption: give apart
  { a: ['ciprofloxacin', 'fluoroquinolone', 'doxycycline', 'tetracycline'], b: ['iron', 'ferrous', 'zinc'], severity: 'MODERATE', effect: 'much less antibiotic absorbed: take the antibiotic 2 hours before or 6 hours after' },
  // Contraception
  { a: ['rifampicin', 'carbamazepine', 'phenytoin', 'phenobarbital', 'efavirenz'], b: ['combined oral contraceptive'], severity: 'MAJOR', effect: 'the pill may fail: advise another method' },
  // Toxicity from raised levels
  { a: ['methotrexate'], b: ['cotrimoxazole', 'nsaid'], severity: 'MAJOR', effect: 'methotrexate toxicity and bone-marrow suppression' },
  { a: ['simvastatin'], b: ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole'], severity: 'MAJOR', effect: 'risk of myopathy and rhabdomyolysis' },
  { a: ['simvastatin'], b: ['amiodarone', 'fluconazole'], severity: 'MODERATE', effect: 'higher statin levels; risk of muscle damage' },
  { a: ['carbamazepine'], b: ['erythromycin', 'clarithromycin', 'fluconazole'], severity: 'MAJOR', effect: 'carbamazepine toxicity' },
  { a: ['theophylline', 'aminophylline'], b: ['ciprofloxacin', 'erythromycin', 'clarithromycin'], severity: 'MAJOR', effect: 'theophylline toxicity (fits, arrhythmia)' },
  { a: ['allopurinol'], b: ['azathioprine', 'mercaptopurine'], severity: 'MAJOR', effect: 'severe bone-marrow suppression' },
  { a: ['fluoroquinolone', 'ciprofloxacin'], b: ['corticosteroid'], severity: 'MODERATE', effect: 'higher risk of tendon rupture, especially in older patients' },
  { a: ['metronidazole'], b: ['mebendazole'], severity: 'MODERATE', effect: 'reported severe skin reactions (Stevens–Johnson)' },
];

/** Classes where two members together are usually a duplication error. */
const DUPLICATE_CLASSES = [
  'nsaid',
  'penicillin',
  'cephalosporin',
  'macrolide',
  'fluoroquinolone',
  'ppi',
  'ace-inhibitor',
  'beta-blocker',
  'ssri',
  'opioid',
  'benzodiazepine',
  'sulfonylurea',
  'statin',
  'antimalarial',
];

/**
 * Checks every pair of drugs. Drugs before `firstNew` were already prescribed (and their alerts
 * already accepted), so pairs made only of those are skipped.
 */
export function interactionAlerts(drugs: DrugLike[], firstNew = 0): Alert[] {
  const alerts: Alert[] = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = Math.max(i + 1, firstNew); j < drugs.length; j++) {
      const [x, y] = [drugs[i], drugs[j]];

      if (norm(x.genericName) === norm(y.genericName)) {
        alerts.push({
          type: 'DUPLICATE',
          severity: 'MODERATE',
          message: x.note || y.note ? `${label(x)} and ${label(y)}: the same drug twice` : `${x.genericName} is prescribed twice`,
          drugIds: [x.id, y.id],
        });
        continue;
      }
      const cls = x.drugClass && norm(x.drugClass);
      if (cls && cls === norm(y.drugClass ?? '') && DUPLICATE_CLASSES.includes(cls)) {
        alerts.push({
          type: 'DUPLICATE',
          severity: 'MODERATE',
          message: `Two ${cls} drugs together: ${label(x)} and ${label(y)}`,
          drugIds: [x.id, y.id],
        });
      }
      // One alert per pair: the most serious rule that applies.
      const rule = INTERACTIONS.filter(
        (r) => (r.a.some((t) => has(x, t)) && r.b.some((t) => has(y, t))) || (r.a.some((t) => has(y, t)) && r.b.some((t) => has(x, t))),
      ).sort((p, q) => (p.severity === q.severity ? 0 : p.severity === 'MAJOR' ? -1 : 1))[0];
      if (rule) {
        alerts.push({ type: 'INTERACTION', severity: rule.severity, message: `${label(x)} + ${label(y)}: ${rule.effect}`, drugIds: [x.id, y.id] });
      }
    }
  }
  return alerts;
}

type SafetyRule = {
  terms: string[];
  /** BLOCK: not given (a reason is required to go ahead); MAJOR: avoid; MODERATE: caution. */
  severity: 'BLOCK' | 'MAJOR' | 'MODERATE';
  effect: string;
  /** Pregnancy weeks the rule applies from / until (when the weeks are known). */
  from?: number;
  to?: number;
};

/**
 * Medicines to avoid in pregnancy, for the drugs Ethiopian clinics commonly stock. Not a full
 * teratology reference: have the clinical advisor review it for the facility's formulary.
 */
export const PREGNANCY_RULES: SafetyRule[] = [
  { terms: ['misoprostol'], severity: 'BLOCK', effect: 'causes miscarriage and uterine rupture (only for an intended obstetric use)' },
  { terms: ['methotrexate'], severity: 'BLOCK', effect: 'causes miscarriage and birth defects' },
  { terms: ['isotretinoin', 'acitretin'], severity: 'BLOCK', effect: 'causes severe birth defects' },
  { terms: ['warfarin'], severity: 'BLOCK', effect: 'causes birth defects and fetal bleeding (heparin is used instead)' },
  { terms: ['valproate', 'valproic acid'], severity: 'BLOCK', effect: 'causes neural tube defects and harms development' },
  { terms: ['enalapril', 'lisinopril', 'captopril', 'ramipril', 'ace inhibitor'], severity: 'MAJOR', effect: 'harms the fetal kidneys (methyldopa or nifedipine are used instead)' },
  { terms: ['losartan', 'valsartan', 'angiotensin receptor blocker'], severity: 'MAJOR', effect: 'harms the fetal kidneys (methyldopa or nifedipine are used instead)' },
  { terms: ['atorvastatin', 'simvastatin', 'rosuvastatin', 'statin'], severity: 'MAJOR', effect: 'is not used in pregnancy: stop until after delivery' },
  { terms: ['doxycycline', 'tetracycline'], severity: 'MAJOR', from: 15, effect: "stains and weakens the baby's teeth and bones" },
  { terms: ['primaquine'], severity: 'MAJOR', effect: 'can break down the red cells of a G6PD-deficient fetus' },
  { terms: ['griseofulvin'], severity: 'MAJOR', effect: 'can cause birth defects' },
  { terms: ['carbamazepine', 'phenytoin'], severity: 'MAJOR', effect: 'risks birth defects: it needs folic acid and specialist review' },
  { terms: ['ethinylestradiol', 'estrogen', 'oestrogen'], severity: 'MAJOR', effect: 'is a hormonal contraceptive, not given in pregnancy' },
  { terms: ['ibuprofen', 'diclofenac', 'naproxen', 'indomethacin', 'nsaid'], severity: 'MAJOR', from: 20, effect: "after 20 weeks can harm the baby's heart and kidneys (paracetamol is used instead)" },
  { terms: ['ciprofloxacin', 'norfloxacin', 'levofloxacin', 'fluoroquinolone'], severity: 'MODERATE', effect: 'is usually avoided in pregnancy when another antibiotic will do' },
  { terms: ['metronidazole', 'tinidazole'], severity: 'MODERATE', to: 13, effect: 'is usually avoided in the first trimester unless clearly needed' },
  { terms: ['albendazole', 'mebendazole'], severity: 'MODERATE', to: 13, effect: 'is not given in the first trimester' },
  { terms: ['cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'trimethoprim'], severity: 'MODERATE', effect: 'is a folate antagonist: avoided in the first trimester and near term unless needed (e.g. HIV prophylaxis)' },
  { terms: ['fluconazole'], severity: 'MODERATE', effect: 'is avoided in high or long courses' },
  { terms: ['codeine', 'tramadol'], severity: 'MODERATE', effect: 'near term can cause withdrawal in the newborn' },
];

/** Medicines to avoid or watch while breastfeeding. */
export const BREASTFEEDING_RULES: SafetyRule[] = [
  { terms: ['methotrexate'], severity: 'BLOCK', effect: 'is not given while breastfeeding' },
  { terms: ['codeine'], severity: 'MAJOR', effect: 'can cause dangerous drowsiness and slowed breathing in the baby' },
  { terms: ['lithium'], severity: 'MAJOR', effect: 'passes into the milk and can harm the baby' },
  { terms: ['amiodarone'], severity: 'MAJOR', effect: 'builds up in the baby' },
  { terms: ['primaquine'], severity: 'MAJOR', effect: 'is given only if the baby is known not to be G6PD deficient' },
  { terms: ['tramadol'], severity: 'MODERATE', effect: 'passes into the milk: watch the baby for drowsiness' },
  { terms: ['doxycycline', 'tetracycline'], severity: 'MODERATE', effect: 'is avoided in longer courses while breastfeeding' },
  { terms: ['ciprofloxacin', 'norfloxacin', 'levofloxacin', 'fluoroquinolone'], severity: 'MODERATE', effect: 'is usually avoided while breastfeeding when another antibiotic will do' },
  { terms: ['metronidazole', 'tinidazole'], severity: 'MODERATE', effect: 'after a single large dose: breastfeeding stops for 12–24 hours' },
  { terms: ['ethinylestradiol', 'estrogen', 'oestrogen'], severity: 'MODERATE', effect: 'can reduce the milk supply (progestogen-only methods are preferred)' },
];

export interface MotherStatus {
  sex: 'MALE' | 'FEMALE';
  /** Age in years at the visit, if known. */
  ageYears: number | null;
  /** NOT_PREGNANT, POSSIBLE, PREGNANT, or null when not asked. */
  pregnancyStatus: string | null;
  /** Weeks of pregnancy from the last period, if known. */
  weeks: number | null;
  breastfeeding: boolean | null;
}

/**
 * Alerts for prescribing in pregnancy and breastfeeding. A possible pregnancy counts as one. For a
 * woman of child-bearing age whose status was not asked, a drug that is not given in pregnancy
 * raises a reminder to ask first.
 */
export function pregnancyAlerts(m: MotherStatus, drugs: DrugLike[]): Alert[] {
  if (m.sex !== 'FEMALE') return [];
  const alerts: Alert[] = [];
  const applies = (r: SafetyRule) => m.weeks === null || ((r.from === undefined || m.weeks >= r.from) && (r.to === undefined || m.weeks < r.to));
  const pregnant = m.pregnancyStatus === 'PREGNANT' || m.pregnancyStatus === 'POSSIBLE';
  const childBearing = m.ageYears === null || (m.ageYears >= 12 && m.ageYears <= 50);
  for (const d of drugs) {
    const rule = PREGNANCY_RULES.find((r) => r.terms.some((t) => has(d, t)) && applies(r));
    if (rule && pregnant) {
      const when = m.pregnancyStatus === 'POSSIBLE' ? 'may be pregnant' : m.weeks !== null ? `is ${m.weeks} weeks pregnant` : 'is pregnant';
      alerts.push({ type: 'PREGNANCY', severity: rule.severity, message: `${d.genericName}: the patient ${when}. It ${rule.effect}.`, drugIds: [d.id] });
    } else if (rule && m.pregnancyStatus === null && childBearing && rule.severity !== 'MODERATE') {
      alerts.push({ type: 'PREGNANCY', severity: 'MODERATE', message: `${d.genericName}: ask whether she could be pregnant first. In pregnancy it ${rule.effect}.`, drugIds: [d.id] });
    }
    const feeding = m.breastfeeding ? BREASTFEEDING_RULES.find((r) => r.terms.some((t) => has(d, t))) : undefined;
    if (feeding) alerts.push({ type: 'BREASTFEEDING', severity: feeding.severity, message: `${d.genericName}: she is breastfeeding. It ${feeding.effect}.`, drugIds: [d.id] });
  }
  return alerts;
}

/** Whole weeks since the first day of the last period, on a given day. */
export function pregnancyWeeks(lmp: Date | null, on: Date) {
  if (!lmp) return null;
  return Math.max(0, Math.floor((on.getTime() - lmp.getTime()) / (7 * 86_400_000)));
}

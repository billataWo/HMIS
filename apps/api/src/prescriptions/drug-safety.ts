/**
 * Prescribing safety checks: allergies, interactions and duplicates.
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
  type: 'ALLERGY' | 'INTERACTION' | 'DUPLICATE';
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

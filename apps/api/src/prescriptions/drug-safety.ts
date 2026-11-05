/**
 * Prescribing safety checks: allergies, interactions and duplicates.
 *
 * The interaction list is a deliberately small starter set of well-established, clinically
 * important pairs. It is not a substitute for a full interaction database; have the clinical
 * advisor review it and extend it for the facility's formulary.
 */

export interface DrugLike {
  id: string;
  genericName: string;
  brandName?: string | null;
  drugClass?: string | null;
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

/** Each side lists generic names or drug classes. */
const INTERACTIONS: { a: string[]; b: string[]; severity: 'MAJOR' | 'MODERATE'; effect: string }[] = [
  { a: ['warfarin'], b: ['nsaid'], severity: 'MAJOR', effect: 'higher risk of serious bleeding' },
  { a: ['warfarin'], b: ['metronidazole', 'ciprofloxacin', 'fluconazole', 'cotrimoxazole'], severity: 'MAJOR', effect: 'raises INR; bleeding risk' },
  { a: ['ace-inhibitor'], b: ['spironolactone', 'potassium chloride'], severity: 'MAJOR', effect: 'risk of hyperkalaemia' },
  { a: ['ace-inhibitor'], b: ['nsaid'], severity: 'MODERATE', effect: 'reduced blood-pressure control and risk of kidney injury' },
  { a: ['methotrexate'], b: ['cotrimoxazole'], severity: 'MAJOR', effect: 'bone-marrow suppression' },
  { a: ['simvastatin'], b: ['clarithromycin', 'erythromycin'], severity: 'MAJOR', effect: 'risk of myopathy and rhabdomyolysis' },
  { a: ['sildenafil'], b: ['nitrate'], severity: 'MAJOR', effect: 'severe hypotension' },
  { a: ['tramadol'], b: ['ssri'], severity: 'MAJOR', effect: 'serotonin syndrome and seizures' },
  { a: ['rifampicin'], b: ['combined oral contraceptive'], severity: 'MAJOR', effect: 'contraceptive failure' },
  { a: ['clopidogrel'], b: ['omeprazole'], severity: 'MODERATE', effect: 'reduced antiplatelet effect' },
  { a: ['digoxin'], b: ['amiodarone'], severity: 'MAJOR', effect: 'digoxin toxicity' },
];

/** Classes where two members together are usually a duplication error. */
const DUPLICATE_CLASSES = ['nsaid', 'penicillin', 'ppi', 'ace-inhibitor', 'ssri'];

/**
 * Checks every pair of drugs. Drugs before `firstNew` were already prescribed (and their alerts
 * already accepted), so pairs made only of those are skipped.
 */
export function interactionAlerts(drugs: DrugLike[], firstNew = 0): Alert[] {
  const alerts: Alert[] = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = Math.max(i + 1, firstNew); j < drugs.length; j++) {
      const [x, y] = [drugs[i], drugs[j]];
      const tx = tokens(x);
      const ty = tokens(y);

      if (norm(x.genericName) === norm(y.genericName)) {
        alerts.push({ type: 'DUPLICATE', severity: 'MODERATE', message: `${x.genericName} is prescribed twice`, drugIds: [x.id, y.id] });
        continue;
      }
      const cls = x.drugClass && norm(x.drugClass);
      if (cls && cls === norm(y.drugClass ?? '') && DUPLICATE_CLASSES.includes(cls)) {
        alerts.push({
          type: 'DUPLICATE',
          severity: 'MODERATE',
          message: `Two ${cls} drugs together: ${x.genericName} and ${y.genericName}`,
          drugIds: [x.id, y.id],
        });
      }
      for (const rule of INTERACTIONS) {
        const hit =
          (rule.a.some((t) => tx.includes(t)) && rule.b.some((t) => ty.includes(t))) ||
          (rule.a.some((t) => ty.includes(t)) && rule.b.some((t) => tx.includes(t)));
        if (hit) {
          alerts.push({
            type: 'INTERACTION',
            severity: rule.severity,
            message: `${x.genericName} + ${y.genericName}: ${rule.effect}`,
            drugIds: [x.id, y.id],
          });
        }
      }
    }
  }
  return alerts;
}

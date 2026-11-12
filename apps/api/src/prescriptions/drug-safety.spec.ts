import { FORMULARY } from '../inventory/formulary.js';
import { allergyAlerts, interactionAlerts, INTERACTIONS, type DrugLike } from './drug-safety.js';

let n = 0;
const drug = (genericName: string, drugClass: string | null = null, extra: Partial<DrugLike> = {}): DrugLike => ({ id: `d${++n}`, genericName, drugClass, ...extra });
const pair = (a: DrugLike, b: DrugLike) => interactionAlerts([a, b]);

describe('interaction checks', () => {
  it('matches whole words in names and classes, not exact strings', () => {
    // "Chloroquine phosphate", "Ferrous sulfate + folic acid": names with more than the rule's word.
    const [alert] = pair(drug('Ciprofloxacin', 'fluoroquinolone'), drug('Ferrous sulfate + folic acid', 'iron'));
    expect(alert).toMatchObject({ type: 'INTERACTION', severity: 'MODERATE' });
    expect(alert.message).toMatch(/take the antibiotic 2 hours before or 6 hours after/);
    expect(pair(drug('Doxycycline', 'tetracycline'), drug('Zinc sulfate'))).toHaveLength(1);
    // A word inside another word is not a match: "dinitrate" is not "nitrate".
    expect(pair(drug('Sildenafil'), drug('Isosorbide dinitrate'))).toHaveLength(1); // matched by "isosorbide"
    expect(pair(drug('Sildenafil'), drug('Glyceryl trinitrate'))).toHaveLength(1);
    expect(pair(drug('Paracetamol', 'analgesic'), drug('Amoxicillin + clavulanic acid', 'penicillin'))).toEqual([]);
  });

  it('catches the classic dangerous pairs from the starter formulary', () => {
    const f = (name: string) => {
      const d = FORMULARY.find((x) => x.genericName === name)!;
      return drug(d.genericName, d.drugClass);
    };
    const cases: [string, string, 'MAJOR' | 'MODERATE'][] = [
      ['Tramadol', 'Diazepam', 'MAJOR'],
      ['Tramadol', 'Fluoxetine', 'MAJOR'],
      ['Amitriptyline', 'Fluoxetine', 'MAJOR'],
      ['Glibenclamide', 'Cotrimoxazole', 'MAJOR'],
      ['Enalapril', 'Spironolactone', 'MAJOR'],
      ['Enalapril', 'Ibuprofen', 'MODERATE'],
      ['Ibuprofen', 'Prednisolone', 'MODERATE'],
      ['Furosemide', 'Diclofenac', 'MODERATE'],
      ['Gentamicin', 'Furosemide', 'MODERATE'],
      ['Simvastatin', 'Erythromycin', 'MAJOR'],
      ['Ciprofloxacin', 'Prednisolone', 'MODERATE'],
      ['Metronidazole', 'Mebendazole', 'MODERATE'],
      ['Glibenclamide', 'Atenolol', 'MODERATE'],
      ['Chlorphenamine', 'Diazepam', 'MODERATE'],
    ];
    for (const [a, b, severity] of cases) {
      const alerts = pair(f(a), f(b)).filter((x) => x.type === 'INTERACTION');
      expect({ a, b, got: alerts.map((x) => x.severity) }).toEqual({ a, b, got: [severity] });
    }
  });

  it('says one thing per pair: the most serious rule', () => {
    // Warfarin + aspirin (an NSAID) and SSRI rules overlap for some pairs; one alert, the major one.
    const alerts = pair(drug('Warfarin', 'anticoagulant'), drug('Aspirin', 'nsaid'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('MAJOR');
  });

  it('flags duplicates by name and by class, naming a current medicine', () => {
    expect(pair(drug('Ibuprofen', 'nsaid'), drug('Diclofenac', 'nsaid'))[0].message).toBe('Two nsaid drugs together: Ibuprofen and Diclofenac');
    expect(pair(drug('Ciprofloxacin', 'fluoroquinolone'), drug('Levofloxacin', 'fluoroquinolone'))[0].type).toBe('DUPLICATE');
    const taking = drug('Amlodipine', 'calcium-channel blocker', { note: 'taking since 2 Nov' });
    expect(pair(taking, drug('Amlodipine', 'calcium-channel blocker'))[0].message).toBe('Amlodipine (taking since 2 Nov) and Amlodipine: the same drug twice');
    const w = drug('Warfarin', 'anticoagulant', { note: 'taking since 2 Nov' });
    expect(pair(w, drug('Ibuprofen', 'nsaid'))[0].message).toBe('Warfarin (taking since 2 Nov) + Ibuprofen: higher risk of serious bleeding');
  });

  it('skips pairs among drugs already checked', () => {
    const old = [drug('Tramadol', 'opioid'), drug('Diazepam', 'benzodiazepine')];
    expect(interactionAlerts([...old, drug('Paracetamol', 'analgesic')], old.length)).toEqual([]);
    expect(interactionAlerts([...old, drug('Fluoxetine', 'ssri')], old.length)).toHaveLength(1);
  });

  it('has no rule that can never match (every term is lower case and written as words)', () => {
    for (const r of INTERACTIONS) for (const t of [...r.a, ...r.b]) expect(t).toMatch(/^[a-z0-9-]+( [a-z0-9-]+)*$/);
  });
});

describe('allergy checks', () => {
  it('still blocks by class alias and by name', () => {
    expect(allergyAlerts(['Penicillin'], [drug('Amoxicillin + clavulanic acid', 'penicillin')])[0]).toMatchObject({ severity: 'BLOCK' });
    expect(allergyAlerts(['sulfa'], [drug('Cotrimoxazole', 'sulfonamide')])).toHaveLength(1);
    expect(allergyAlerts(['Aspirin'], [drug('Ibuprofen', 'nsaid')])).toHaveLength(1);
    expect(allergyAlerts(['Penicillin'], [drug('Ciprofloxacin', 'fluoroquinolone')])).toEqual([]);
  });
});

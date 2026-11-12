/**
 * A starting list of medicines common in Ethiopian private clinics, drawn from the national
 * essential medicines list, for a new clinic to pick from instead of typing its formulary in.
 * No prices: each clinic sets its own (a price of 0 would make the drug free). Classes use the
 * names the allergy, interaction and duplicate checks know (drug-safety.ts). Have the clinic's
 * pharmacist confirm strengths and pack sizes against what their suppliers actually sell.
 */
export interface FormularyDrug {
  group: string;
  genericName: string;
  strength: string | null;
  form: string; // one of the forms the drug form offers
  unit: string;
  drugClass: string | null;
  packSize?: number;
  packName?: string;
  controlled?: 'NARCOTIC' | 'PSYCHOTROPIC';
}

const d = (
  group: string,
  genericName: string,
  strength: string | null,
  form: string,
  unit: string,
  drugClass: string | null,
  pack?: [number, string],
): FormularyDrug => ({ group, genericName, strength, form, unit, drugClass, ...(pack && { packSize: pack[0], packName: pack[1] }) });

const PAIN = 'Pain and fever';
const ANTI = 'Antibiotics';
const MAL = 'Malaria and parasites';
const GI = 'Stomach and gut';
const CV = 'Heart, blood pressure and diabetes';
const RESP = 'Breathing, allergy and steroids';
const MH = "Nerves and mental health";
const WOMEN = "Women's health";
const FLUID = 'Fluids and injections';
const SKIN = 'Skin and eyes';
const SUPP = 'Supplements';

export const FORMULARY: FormularyDrug[] = [
  d(PAIN, 'Paracetamol', '500 mg', 'tablet', 'tablet', 'analgesic', [100, 'box']),
  d(PAIN, 'Paracetamol', '120 mg/5 ml', 'syrup', 'bottle', 'analgesic'),
  d(PAIN, 'Ibuprofen', '400 mg', 'tablet', 'tablet', 'nsaid', [100, 'box']),
  d(PAIN, 'Diclofenac', '50 mg', 'tablet', 'tablet', 'nsaid', [100, 'box']),
  d(PAIN, 'Diclofenac', '75 mg/3 ml', 'injection', 'ampoule', 'nsaid', [10, 'box']),
  d(PAIN, 'Aspirin', '81 mg', 'tablet', 'tablet', 'nsaid', [100, 'box']),
  { ...d(PAIN, 'Tramadol', '50 mg', 'capsule', 'capsule', 'opioid', [100, 'box']), controlled: 'NARCOTIC' },

  d(ANTI, 'Amoxicillin', '500 mg', 'capsule', 'capsule', 'penicillin', [100, 'box']),
  d(ANTI, 'Amoxicillin', '250 mg/5 ml', 'suspension', 'bottle', 'penicillin'),
  d(ANTI, 'Amoxicillin + clavulanic acid', '625 mg', 'tablet', 'tablet', 'penicillin', [14, 'pack']),
  d(ANTI, 'Cloxacillin', '500 mg', 'capsule', 'capsule', 'penicillin', [100, 'box']),
  d(ANTI, 'Benzathine benzylpenicillin', '2.4 MIU', 'injection', 'vial', 'penicillin'),
  d(ANTI, 'Ceftriaxone', '1 g', 'injection', 'vial', 'cephalosporin'),
  d(ANTI, 'Cefalexin', '500 mg', 'capsule', 'capsule', 'cephalosporin', [100, 'box']),
  d(ANTI, 'Ciprofloxacin', '500 mg', 'tablet', 'tablet', 'fluoroquinolone', [100, 'box']),
  d(ANTI, 'Azithromycin', '500 mg', 'tablet', 'tablet', 'macrolide', [3, 'pack']),
  d(ANTI, 'Erythromycin', '500 mg', 'tablet', 'tablet', 'macrolide', [100, 'box']),
  d(ANTI, 'Doxycycline', '100 mg', 'capsule', 'capsule', 'tetracycline', [100, 'box']),
  d(ANTI, 'Cotrimoxazole', '960 mg', 'tablet', 'tablet', 'sulfonamide', [100, 'box']),
  d(ANTI, 'Metronidazole', '250 mg', 'tablet', 'tablet', 'nitroimidazole', [100, 'box']),
  d(ANTI, 'Nitrofurantoin', '100 mg', 'tablet', 'tablet', null, [100, 'box']),
  d(ANTI, 'Gentamicin', '80 mg/2 ml', 'injection', 'ampoule', 'aminoglycoside', [10, 'box']),

  d(MAL, 'Artemether + lumefantrine', '20/120 mg', 'tablet', 'tablet', 'antimalarial', [24, 'pack']),
  d(MAL, 'Chloroquine phosphate', '250 mg', 'tablet', 'tablet', 'antimalarial', [100, 'box']),
  d(MAL, 'Primaquine', '7.5 mg', 'tablet', 'tablet', 'antimalarial', [100, 'box']),
  d(MAL, 'Artesunate', '60 mg', 'injection', 'vial', 'antimalarial'),
  d(MAL, 'Albendazole', '400 mg', 'tablet', 'tablet', 'anthelmintic'),
  d(MAL, 'Mebendazole', '100 mg', 'tablet', 'tablet', 'anthelmintic', [6, 'strip']),
  d(MAL, 'Fluconazole', '150 mg', 'capsule', 'capsule', 'antifungal'),

  d(GI, 'Omeprazole', '20 mg', 'capsule', 'capsule', 'ppi', [100, 'box']),
  d(GI, 'Oral rehydration salts', null, 'sachet', 'sachet', null, [50, 'box']),
  d(GI, 'Zinc sulfate', '20 mg', 'tablet', 'tablet', null, [10, 'strip']),
  d(GI, 'Metoclopramide', '10 mg', 'tablet', 'tablet', 'antiemetic', [100, 'box']),
  d(GI, 'Hyoscine butylbromide', '10 mg', 'tablet', 'tablet', 'antispasmodic', [100, 'box']),

  d(CV, 'Amlodipine', '5 mg', 'tablet', 'tablet', 'calcium-channel blocker', [100, 'box']),
  d(CV, 'Enalapril', '5 mg', 'tablet', 'tablet', 'ace-inhibitor', [100, 'box']),
  d(CV, 'Hydrochlorothiazide', '25 mg', 'tablet', 'tablet', 'thiazide', [100, 'box']),
  d(CV, 'Atenolol', '50 mg', 'tablet', 'tablet', 'beta-blocker', [100, 'box']),
  d(CV, 'Furosemide', '40 mg', 'tablet', 'tablet', 'loop diuretic', [100, 'box']),
  d(CV, 'Spironolactone', '25 mg', 'tablet', 'tablet', 'diuretic', [100, 'box']),
  d(CV, 'Simvastatin', '20 mg', 'tablet', 'tablet', 'statin', [100, 'box']),
  d(CV, 'Metformin', '500 mg', 'tablet', 'tablet', 'biguanide', [100, 'box']),
  d(CV, 'Glibenclamide', '5 mg', 'tablet', 'tablet', 'sulfonylurea', [100, 'box']),
  d(CV, 'Insulin isophane (NPH)', '100 IU/ml', 'injection', 'vial', 'insulin'),

  d(RESP, 'Salbutamol', '100 mcg/dose', 'inhaler', 'inhaler', 'bronchodilator'),
  d(RESP, 'Chlorphenamine', '4 mg', 'tablet', 'tablet', 'antihistamine', [100, 'box']),
  d(RESP, 'Prednisolone', '5 mg', 'tablet', 'tablet', 'corticosteroid', [100, 'box']),
  d(RESP, 'Dexamethasone', '4 mg/ml', 'injection', 'ampoule', 'corticosteroid', [10, 'box']),
  d(RESP, 'Hydrocortisone', '100 mg', 'injection', 'vial', 'corticosteroid'),

  { ...d(MH, 'Diazepam', '5 mg', 'tablet', 'tablet', 'benzodiazepine', [100, 'box']), controlled: 'PSYCHOTROPIC' },
  d(MH, 'Amitriptyline', '25 mg', 'tablet', 'tablet', 'tricyclic antidepressant', [100, 'box']),
  d(MH, 'Fluoxetine', '20 mg', 'capsule', 'capsule', 'ssri', [100, 'box']),

  d(WOMEN, 'Levonorgestrel + ethinylestradiol', '0.15/0.03 mg', 'tablet', 'cycle', 'combined oral contraceptive'),
  d(WOMEN, 'Medroxyprogesterone acetate', '150 mg/ml', 'injection', 'vial', 'progestogen contraceptive'),
  d(WOMEN, 'Oxytocin', '10 IU/ml', 'injection', 'ampoule', 'uterotonic', [10, 'box']),

  d(FLUID, 'Sodium chloride (1000 ml)', '0.9%', 'injection', 'bag', 'iv fluid'),
  d(FLUID, "Ringer's lactate (1000 ml)", null, 'injection', 'bag', 'iv fluid'),
  d(FLUID, 'Dextrose (1000 ml)', '5%', 'injection', 'bag', 'iv fluid'),
  d(FLUID, 'Lidocaine', '2%', 'injection', 'vial', 'local anaesthetic'),

  d(SKIN, 'Clotrimazole', '1%', 'cream', 'tube', 'antifungal'),
  d(SKIN, 'Tetracycline eye ointment', '1%', 'ointment', 'tube', 'tetracycline'),

  d(SUPP, 'Ferrous sulfate + folic acid', '200/0.4 mg', 'tablet', 'tablet', 'iron', [100, 'box']),
  d(SUPP, 'Folic acid', '5 mg', 'tablet', 'tablet', null, [100, 'box']),
];

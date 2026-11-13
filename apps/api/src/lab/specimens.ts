/**
 * What a test is done on, and the tube or container that goes with it. Tests with the same
 * specimen are taken in one tube and share its sample number. (The web keeps the same list in
 * lib/specimens.ts.)
 */
export const SPECIMENS = {
  EDTA: 'Whole blood, EDTA (purple top)',
  SERUM: 'Serum (red or yellow top)',
  FLUORIDE: 'Plasma, fluoride (grey top)',
  CITRATE: 'Blood, citrate (light blue top)',
  HEPARIN: 'Plasma, heparin (green top)',
  CAPILLARY: 'Capillary blood (finger prick)',
  URINE: 'Urine (clean-catch cup)',
  STOOL: 'Stool (container)',
  SPUTUM: 'Sputum (container)',
  SWAB: 'Swab',
  CSF: 'Cerebrospinal fluid',
  OTHER: 'Other',
} as const;

export type Specimen = keyof typeof SPECIMENS;
export const SPECIMEN_CODES = Object.keys(SPECIMENS) as [Specimen, ...Specimen[]];

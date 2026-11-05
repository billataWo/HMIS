/**
 * Starter list of common outpatient diagnoses with ICD-11 (MMS) codes, for quick search.
 * Doctors can still enter any other ICD-11 code by hand. Have the clinical advisor review this
 * list against the WHO ICD-11 browser (https://icd.who.int/browse/2024-01/mms/en) and extend it
 * with the facility's own top diagnoses.
 */
export const ICD11_COMMON: { code: string; label: string; labelAm?: string; keywords?: string }[] = [
  // Infectious and parasitic
  { code: '1F40', label: 'Malaria due to Plasmodium falciparum', labelAm: 'ወባ', keywords: 'malaria pf' },
  { code: '1F41', label: 'Malaria due to Plasmodium vivax', labelAm: 'ወባ', keywords: 'malaria pv' },
  { code: '1F4Z', label: 'Malaria, unspecified', labelAm: 'ወባ', keywords: 'malaria' },
  { code: '1A07', label: 'Typhoid fever', labelAm: 'ታይፎይድ', keywords: 'enteric salmonella' },
  { code: '1A40', label: 'Gastroenteritis or colitis without specification of infectious agent', keywords: 'diarrhoea diarrhea age' },
  { code: '1A00', label: 'Cholera', keywords: 'diarrhoea' },
  { code: '1A36', label: 'Amoebiasis', labelAm: 'አሜባ', keywords: 'amoeba amebiasis' },
  { code: '1A31', label: 'Giardiasis', labelAm: 'ጃርዲያ', keywords: 'giardia' },
  { code: '1F62', label: 'Ascariasis', keywords: 'worms helminth' },
  { code: '1B10', label: 'Tuberculosis of the respiratory system', labelAm: 'ቲቢ', keywords: 'tb ptb pulmonary' },
  { code: '1C62', label: 'HIV disease', keywords: 'hiv aids' },
  { code: '1E50.0', label: 'Acute hepatitis A', keywords: 'hepatitis jaundice' },
  { code: '1E51.0', label: 'Chronic hepatitis B', keywords: 'hepatitis hbv' },
  { code: '1F03', label: 'Measles', labelAm: 'ኩፍኝ' },
  { code: '1E90', label: 'Varicella', keywords: 'chickenpox' },
  { code: '1D20', label: 'Dengue fever', keywords: 'dengue' },
  { code: '1G04', label: 'Scabies', labelAm: 'እከክ' },
  { code: '1F28', label: 'Dermatophytosis', keywords: 'tinea ringworm fungal' },
  { code: '1B70', label: 'Bacterial cellulitis, erysipelas or lymphangitis', keywords: 'cellulitis skin infection' },
  // Respiratory
  { code: 'CA00', label: 'Acute nasopharyngitis', labelAm: 'ጉንፋን', keywords: 'common cold urti' },
  { code: 'CA01', label: 'Acute sinusitis', keywords: 'sinus' },
  { code: 'CA02', label: 'Acute pharyngitis', keywords: 'sore throat urti' },
  { code: 'CA03', label: 'Acute tonsillitis', keywords: 'tonsils urti' },
  { code: 'CA07', label: 'Acute upper respiratory infections of multiple or unspecified sites', keywords: 'urti' },
  { code: 'CA08.0', label: 'Allergic rhinitis', keywords: 'hay fever' },
  { code: 'CA20', label: 'Acute bronchitis', keywords: 'cough' },
  { code: 'CA23', label: 'Asthma', labelAm: 'አስም' },
  { code: 'CA40', label: 'Pneumonia', labelAm: 'የሳንባ ምች', keywords: 'chest infection cap' },
  // Cardiovascular and metabolic
  { code: 'BA00', label: 'Essential hypertension', labelAm: 'የደም ግፊት', keywords: 'htn blood pressure' },
  { code: 'BA01', label: 'Hypertensive heart disease', keywords: 'htn' },
  { code: 'BD10', label: 'Congestive heart failure', keywords: 'chf ccf' },
  { code: '5A10', label: 'Type 1 diabetes mellitus', labelAm: 'ስኳር', keywords: 'dm t1dm' },
  { code: '5A11', label: 'Type 2 diabetes mellitus', labelAm: 'ስኳር', keywords: 'dm t2dm' },
  { code: '5B81', label: 'Obesity' },
  { code: '5C80', label: 'Hyperlipoproteinaemia', keywords: 'dyslipidaemia cholesterol' },
  { code: '3A00', label: 'Iron deficiency anaemia', labelAm: 'የደም ማነስ', keywords: 'anemia ida' },
  { code: '3A9Z', label: 'Anaemia, unspecified', labelAm: 'የደም ማነስ', keywords: 'anemia' },
  // Digestive
  { code: 'DA22', label: 'Gastro-oesophageal reflux disease', keywords: 'gerd reflux heartburn' },
  { code: 'DA42', label: 'Gastritis', labelAm: 'ጨጓራ', keywords: 'dyspepsia epigastric' },
  { code: 'DA61', label: 'Peptic ulcer, site unspecified', labelAm: 'ጨጓራ', keywords: 'pud ulcer' },
  { code: 'DA08', label: 'Dental caries', keywords: 'tooth decay' },
  { code: 'DB10', label: 'Acute appendicitis' },
  { code: 'DB60', label: 'Haemorrhoids', keywords: 'hemorrhoids piles' },
  // Genitourinary
  { code: 'GC08', label: 'Urinary tract infection, site not specified', keywords: 'uti' },
  { code: 'GB61', label: 'Chronic kidney disease', keywords: 'ckd renal' },
  { code: 'GA90', label: 'Hyperplasia of prostate', keywords: 'bph' },
  // Nervous system and mental health
  { code: '8A80', label: 'Migraine', keywords: 'headache' },
  { code: '8A81', label: 'Tension-type headache', keywords: 'headache' },
  { code: '8A60', label: 'Epilepsy or seizures', labelAm: 'የሚጥል በሽታ', keywords: 'seizure' },
  { code: '6A70', label: 'Single episode depressive disorder', keywords: 'depression' },
  { code: '6B00', label: 'Generalised anxiety disorder', keywords: 'anxiety gad' },
  // Eye and ear
  { code: '9A60', label: 'Conjunctivitis', keywords: 'red eye' },
  { code: 'AB00', label: 'Acute otitis media', keywords: 'ear infection aom' },
  // Musculoskeletal
  { code: 'FA20', label: 'Rheumatoid arthritis', keywords: 'ra joint' },
  { code: 'ME84.2', label: 'Low back pain', keywords: 'lbp backache' },
  // Symptoms
  { code: 'MG26', label: 'Fever of other or unknown origin', labelAm: 'ትኩሳት', keywords: 'fever pyrexia' },
];

/** Matches ICD-11 MMS stem codes such as "CA40", "1F4Z" or "ME84.2" (extension codes after & are allowed). */
export const ICD11_CODE = /^[0-9A-HJ-NP-Z]{4}(\.[0-9A-HJ-NP-Z]{1,2})?(&[0-9A-Z.&/]+)?$/;

export function searchIcd(q: string, take = 15) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ICD11_COMMON.filter((d) => {
    const hay = `${d.code} ${d.label} ${d.labelAm ?? ''} ${d.keywords ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }).slice(0, take);
}

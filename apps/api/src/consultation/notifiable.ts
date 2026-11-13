/**
 * Diseases that must be reported to public health (Ethiopia's IDSR / PHEM priority list).
 *
 * Immediately reportable: phone the woreda health office within 30 minutes of suspecting a case,
 * then send the written case form. Weekly reportable: counted on the weekly IDSR report, zero
 * included. A diagnosis matches by ICD-11 code prefix or by words in its label, so free-text
 * diagnoses are caught too.
 *
 * Have the facility's PHEM focal person check this list against EPHI's current one before go-live.
 */
export type NotifiableDisease = {
  key: string;
  label: string;
  labelAm: string;
  immediate: boolean;
  /** ICD-11 code prefixes. */
  codes: string[];
  terms: RegExp;
};

export const NOTIFIABLE: NotifiableDisease[] = [
  // Immediately reportable (COVID-19 before SARS: "SARS-CoV-2" must not count as SARS).
  { key: 'AFP_POLIO', label: 'Acute flaccid paralysis / polio', labelAm: 'ድንገተኛ ልምሻ / ፖሊዮ', immediate: true, codes: ['1C81'], terms: /polio|acute flaccid paralysis|\bAFP\b/i },
  { key: 'ANTHRAX', label: 'Anthrax', labelAm: 'የአባ ሰንጋ በሽታ', immediate: true, codes: ['1B97'], terms: /anthrax/i },
  { key: 'AVIAN_INFLUENZA', label: 'Avian human influenza', labelAm: 'የወፍ ኢንፍሉዌንዛ', immediate: true, codes: [], terms: /avian|bird flu|\bH5N1\b|\bH7N9\b/i },
  { key: 'CHOLERA', label: 'Cholera / acute watery diarrhoea', labelAm: 'ኮሌራ', immediate: true, codes: ['1A00'], terms: /cholera|acute watery diarrh/i },
  { key: 'COVID19', label: 'COVID-19', labelAm: 'ኮቪድ-19', immediate: true, codes: ['RA01'], terms: /covid|sars-?cov-?2/i },
  { key: 'GUINEA_WORM', label: 'Dracunculiasis (guinea worm)', labelAm: 'የጊኒ ትል', immediate: true, codes: [], terms: /dracuncul|guinea worm/i },
  { key: 'MEASLES', label: 'Measles', labelAm: 'ኩፍኝ', immediate: true, codes: ['1F03'], terms: /measles|ኩፍኝ/i },
  { key: 'MPOX', label: 'Mpox', labelAm: 'ኤምፖክስ', immediate: true, codes: ['1E71'], terms: /mpox|monkeypox/i },
  { key: 'NEONATAL_TETANUS', label: 'Neonatal tetanus', labelAm: 'የአራስ ቴታነስ', immediate: true, codes: ['1C15'], terms: /neonatal tetanus|tetanus neonatorum/i },
  { key: 'PANDEMIC_INFLUENZA', label: 'Pandemic influenza A', labelAm: 'ወረርሽኝ ኢንፍሉዌንዛ', immediate: true, codes: [], terms: /pandemic influenza/i },
  { key: 'RABIES', label: 'Rabies', labelAm: 'የእብድ ውሻ በሽታ', immediate: true, codes: ['1C82'], terms: /rabies/i },
  { key: 'SARS', label: 'SARS', labelAm: 'ሳርስ', immediate: true, codes: [], terms: /\bSARS\b(?!-?CoV)|severe acute respiratory syndrome(?! coronavirus 2)/i },
  { key: 'SMALLPOX', label: 'Smallpox', labelAm: 'ፈንጣጣ', immediate: true, codes: ['1E70'], terms: /smallpox|variola/i },
  { key: 'VHF', label: 'Viral haemorrhagic fever', labelAm: 'ደም የሚያፈስ የቫይረስ ትኩሳት', immediate: true, codes: [], terms: /ebola|marburg|lassa|crimean|ha?emorrhagic fever/i },
  { key: 'YELLOW_FEVER', label: 'Yellow fever', labelAm: 'ቢጫ ወባ', immediate: true, codes: ['1D47'], terms: /yellow fever/i },
  // Weekly reportable.
  { key: 'MALARIA', label: 'Malaria', labelAm: 'ወባ', immediate: false, codes: ['1F4'], terms: /malaria/i },
  { key: 'MENINGITIS', label: 'Meningitis', labelAm: 'ማጅራት ገትር', immediate: false, codes: ['1C1C', '1D01'], terms: /meningitis|meningococc/i },
  { key: 'DYSENTERY', label: 'Dysentery', labelAm: 'ተቅማጥ ከደም ጋር', immediate: false, codes: ['1A02'], terms: /dysenter|shigell|bloody diarrh/i },
  { key: 'TYPHOID', label: 'Typhoid fever', labelAm: 'ታይፎይድ', immediate: false, codes: ['1A07'], terms: /typhoid|enteric fever/i },
  { key: 'RELAPSING_FEVER', label: 'Relapsing fever', labelAm: 'የሚያገረሽ ትኩሳት', immediate: false, codes: [], terms: /relapsing fever/i },
  { key: 'TYPHUS', label: 'Epidemic typhus', labelAm: 'ታይፈስ', immediate: false, codes: [], terms: /typhus/i },
  { key: 'SAM', label: 'Severe acute malnutrition', labelAm: 'ከፍተኛ የምግብ እጥረት', immediate: false, codes: [], terms: /severe acute malnutrition|kwashiorkor|marasm/i },
];

export const NOTIFIABLE_BY_KEY = new Map(NOTIFIABLE.map((d) => [d.key, d]));

/** The notifiable disease a diagnosis is a case of, if any. */
export function notifiableFor(d: { icd11Code: string; label: string }): NotifiableDisease | null {
  const code = d.icd11Code.toUpperCase();
  return NOTIFIABLE.find((n) => n.codes.some((c) => code.startsWith(c)) || n.terms.test(d.label)) ?? null;
}

/** The notifiable diseases among a visit's diagnoses, each once. */
export function notifiableIn(diagnoses: { icd11Code: string; label: string }[]): NotifiableDisease[] {
  const found = new Map<string, NotifiableDisease>();
  for (const d of diagnoses) {
    const n = notifiableFor(d);
    if (n) found.set(n.key, n);
  }
  return [...found.values()];
}

/** Malaria species from a test result's wording: mixed, P. falciparum, P. vivax or not stated. */
export function malariaSpecies(result: string): 'MIXED' | 'PF' | 'PV' | 'OTHER' {
  const pf = /falciparum|\bp\.?\s?f\b|\bpf\b/i.test(result);
  const pv = /vivax|\bp\.?\s?v\b|\bpv\b/i.test(result);
  if (/mixed/i.test(result) || (pf && pv)) return 'MIXED';
  if (pf) return 'PF';
  if (pv) return 'PV';
  return 'OTHER';
}

/**
 * The epidemiological week (Monday to Sunday, ISO numbering) containing a clinic day, as
 * YYYY-MM-DD days: `start` is the Monday, `end` the following Monday (exclusive).
 */
export function epiWeek(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const next = new Date(monday);
  next.setUTCDate(monday.getUTCDate() + 7);
  // ISO week number: the week with the year's first Thursday is week 1.
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * 86_400_000)) + 1;
  return { year, week, start: monday.toISOString().slice(0, 10), end: next.toISOString().slice(0, 10) };
}

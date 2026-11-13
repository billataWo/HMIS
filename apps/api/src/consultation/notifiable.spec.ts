import { epiWeek, malariaSpecies, notifiableFor, notifiableIn } from './notifiable.js';

describe('notifiable diseases', () => {
  it('matches by ICD-11 code or by the words of the diagnosis', () => {
    expect(notifiableFor({ icd11Code: '1F03', label: 'Measles' })).toMatchObject({ key: 'MEASLES', immediate: true });
    expect(notifiableFor({ icd11Code: '1F40', label: 'Malaria due to Plasmodium falciparum' })).toMatchObject({ key: 'MALARIA', immediate: false });
    expect(notifiableFor({ icd11Code: '1A40', label: 'Suspected cholera' })?.key).toBe('CHOLERA');
    expect(notifiableFor({ icd11Code: 'RA01.0', label: 'COVID-19, virus identified (SARS-CoV-2)' })?.key).toBe('COVID19'); // not SARS
    expect(notifiableFor({ icd11Code: 'XX', label: 'Severe acute malnutrition with oedema' })?.key).toBe('SAM');
  });

  it('leaves everyday diagnoses alone', () => {
    for (const [icd11Code, label] of [
      ['CA00', 'Acute nasopharyngitis'],
      ['1A40', 'Gastroenteritis or colitis without specification of infectious agent'],
      ['BA00', 'Essential hypertension'],
      ['1C62', 'HIV disease'],
    ]) {
      expect(notifiableFor({ icd11Code, label })).toBeNull();
    }
  });

  it('lists each disease of a visit once', () => {
    expect(notifiableIn([
      { icd11Code: '1F40', label: 'Malaria due to Plasmodium falciparum' },
      { icd11Code: '1F41', label: 'Malaria due to Plasmodium vivax' },
    ]).map((d) => d.key)).toEqual(['MALARIA']);
  });

  it('reads the malaria species from the result', () => {
    expect(['P. falciparum', 'P. vivax', 'Mixed (Pf + Pv)', 'Positive'].map(malariaSpecies)).toEqual(['PF', 'PV', 'MIXED', 'OTHER']);
  });

  it('finds the Monday-to-Sunday epidemiological week', () => {
    expect(epiWeek('2026-11-13')).toEqual({ year: 2026, week: 46, start: '2026-11-09', end: '2026-11-16' });
    expect(epiWeek('2026-11-09')).toMatchObject({ start: '2026-11-09' }); // a Monday
    expect(epiWeek('2026-11-15')).toMatchObject({ start: '2026-11-09' }); // a Sunday
    expect(epiWeek('2027-01-01')).toEqual({ year: 2026, week: 53, start: '2026-12-28', end: '2027-01-04' });
  });
});

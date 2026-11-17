import { ancAlerts, derivedRisks, eddFrom, gestation, lmpFromEdd, nextContactOn } from './anc-rules.js';

describe('antenatal care rules', () => {
  it('works out gestational age and the due date from the last period', () => {
    expect(gestation('2026-06-01', '2026-11-14')).toEqual({ weeks: 23, days: 5, totalDays: 166 });
    expect(eddFrom('2026-06-01')).toBe('2027-03-08');
    expect(lmpFromEdd('2027-03-08')).toBe('2026-06-01');
  });

  it('books the next of the eight contacts', () => {
    expect(nextContactOn('2026-06-01', 10)).toBe('2026-10-19'); // 20 weeks
    expect(nextContactOn('2026-06-01', 23)).toBe('2026-11-30'); // 26 weeks
    expect(nextContactOn('2026-06-01', 36)).toBe('2027-02-22'); // 38 weeks
    expect(nextContactOn('2026-06-01', 40)).toBe('2027-03-15'); // past 40: a week on
  });

  it('raises urgent alerts for pre-eclampsia, severe anaemia, danger signs and positive tests', () => {
    const urgent = (f: Parameters<typeof ancAlerts>[0]) => ancAlerts(f).filter((a) => a.level === 'URGENT').map((a) => a.text);
    expect(urgent({ gaWeeks: 30, systolicBp: 150, diastolicBp: 95, urineProtein: 'PLUS2' })[0]).toMatch(/pre-eclampsia/);
    expect(ancAlerts({ gaWeeks: 30, systolicBp: 145, diastolicBp: 92, urineProtein: 'NEGATIVE' })).toEqual([{ level: 'WARNING', text: expect.stringMatching(/High blood pressure/) }]);
    expect(urgent({ gaWeeks: 12, systolicBp: 165, diastolicBp: 100 })[0]).toMatch(/Severe high blood pressure/);
    expect(urgent({ gaWeeks: 20, hb: 6.5 })[0]).toMatch(/Severe anaemia/);
    expect(ancAlerts({ gaWeeks: 20, hb: 10.2 })[0].level).toBe('WARNING');
    expect(urgent({ gaWeeks: 28, dangerSigns: ['BLEEDING', 'HEADACHE'] })[0]).toMatch(/Vaginal bleeding, Severe headache/);
    expect(urgent({ gaWeeks: 16, syphilis: 'POSITIVE' })[0]).toMatch(/benzathine/);
    expect(urgent({ gaWeeks: 24, fetalHeartRate: 95 })[0]).toMatch(/Fetal heart/);
    expect(urgent({ gaWeeks: 41 })[0]).toMatch(/past term/);
    expect(ancAlerts({ gaWeeks: 16, systolicBp: 110, diastolicBp: 70, hb: 12.5, fetalHeartRate: 140 })).toEqual([]);
  });

  it('adds the risks that follow from age and births', () => {
    expect(derivedRisks(16, 0)).toEqual(['AGE_UNDER_18']);
    expect(derivedRisks(38, 5)).toEqual(['AGE_35_PLUS', 'GRAND_MULTIPARA']);
    expect(derivedRisks(null, 1)).toEqual([]);
  });
});

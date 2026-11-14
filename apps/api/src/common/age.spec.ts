import { dobFromAge, ethiopianToGregorianDay } from './age.js';

const day = (d: Date) => d.toISOString().slice(0, 10);

describe('birth dates from an age', () => {
  it('counts back from today in years and months', () => {
    expect(day(dobFromAge(0, 3, '2026-11-14'))).toBe('2026-08-14');
    expect(day(dobFromAge(1, 4, '2026-11-14'))).toBe('2025-07-14');
    expect(day(dobFromAge(30, 0, '2026-11-14'))).toBe('1996-11-14');
    expect(day(dobFromAge(0, 11, '2026-01-10'))).toBe('2025-02-10');
  });

  it('keeps the day inside a shorter month', () => {
    expect(day(dobFromAge(0, 3, '2026-05-31'))).toBe('2026-02-28');
    expect(day(dobFromAge(2, 3, '2026-05-31'))).toBe('2024-02-29');
  });
});

describe('Ethiopian calendar birth dates', () => {
  it('converts real days and refuses the rest', () => {
    expect(ethiopianToGregorianDay('2010-01-01')).toBe('2017-09-11');
    expect(ethiopianToGregorianDay('2015-13-06')).toBe('2023-09-11'); // Pagume 6 of a leap year
    expect(ethiopianToGregorianDay('2016-13-06')).toBeNull();
    expect(ethiopianToGregorianDay('2016-14-01')).toBeNull();
    expect(ethiopianToGregorianDay('2016-05-31')).toBeNull();
  });
});

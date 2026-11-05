/**
 * Ethiopian ↔ Gregorian calendar conversion via Julian day numbers (Amete Mihret epoch).
 * Ethiopian years have 12 months of 30 days plus Pagume (5 days, 6 in a leap year,
 * i.e. when year % 4 === 3).
 */
const EPOCH = 1723856;

export function gregorianToJdn(y: number, m: number, d: number) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

export function jdnToGregorian(jdn: number) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

export function ethiopianToJdn(y: number, m: number, d: number) {
  return EPOCH + 365 + 365 * (y - 1) + Math.floor(y / 4) + 30 * (m - 1) + d - 1;
}

export function jdnToEthiopian(jdn: number) {
  const offset = jdn - EPOCH;
  const r = ((offset % 1461) + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor(offset / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (g: { year: number; month: number; day: number }) => `${g.year}-${pad(g.month)}-${pad(g.day)}`;

/** Gregorian YYYY-MM-DD → Ethiopian date. */
export function toEthiopian(isoDay: string) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return jdnToEthiopian(gregorianToJdn(y, m, d));
}

/** First Gregorian day of an Ethiopian month, and the first day of the following month. */
export function ethiopianMonthRange(year: number, month: number) {
  const start = jdnToGregorian(ethiopianToJdn(year, month, 1));
  const next = month === 13 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const end = jdnToGregorian(ethiopianToJdn(next.y, next.m, 1));
  return { startDay: isoOf(start), endDay: isoOf(end) };
}

export const ETHIOPIAN_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
];
export const ETHIOPIAN_MONTHS_AM = ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];

import { ethiopianToJdn, jdnToEthiopian, jdnToGregorian } from './ethiopian-calendar.js';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The birth date implied by an age given at the desk ("3 years", "7 months", "1 year 4 months"),
 * counted back from `today` (YYYY-MM-DD), so a baby of 3 months is 3 months old today, not as old
 * as the 1st of January makes them. The day is clamped to the month's length (31 May less 3 months
 * is 28 or 29 February).
 */
export function dobFromAge(years: number, months: number, today: string): Date {
  const [y, m, d] = today.split('-').map(Number);
  const total = y * 12 + (m - 1) - years * 12 - months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last)));
}

/**
 * An Ethiopian calendar date (YYYY-MM-DD, month 13 is Pagume) as a Gregorian YYYY-MM-DD, or null
 * when no such day exists (day 31, Pagume 6 outside a leap year).
 */
export function ethiopianToGregorianDay(ec: string): string | null {
  const [y, m, d] = ec.split('-').map(Number);
  if (!y || m < 1 || m > 13 || d < 1 || d > 30) return null;
  if (m === 13 && d > (y % 4 === 3 ? 6 : 5)) return null;
  const jdn = ethiopianToJdn(y, m, d);
  // Round trip: the day must come back as itself.
  const back = jdnToEthiopian(jdn);
  if (back.year !== y || back.month !== m || back.day !== d) return null;
  const g = jdnToGregorian(jdn);
  return `${g.year}-${pad(g.month)}-${pad(g.day)}`;
}

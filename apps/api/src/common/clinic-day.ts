// Ethiopia is UTC+3 all year (no daylight saving). A per-facility time zone can replace this
// if the product expands beyond Ethiopia.
const TZ = 'Africa/Addis_Ababa';
const OFFSET = '+03:00';

/** The clinic's local calendar day as YYYY-MM-DD. */
export function clinicDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** UTC instants bounding a local clinic day: [start, end). */
export function dayRange(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00${OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD: not 2026-13-45, and not 2026-02-30 (which Date rolls over). */
export const isDay = (day: string | undefined | null): day is string => !!day && DAY_PATTERN.test(day) && !Number.isNaN(Date.parse(day)) && clinicDay(dayRange(day).start) === day;

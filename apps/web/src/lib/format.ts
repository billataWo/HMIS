import type { BadgeTone } from "@/components/ui";
import type { T } from "./i18n";

/** English words for the formatters below when no translator is passed. */
export const EN: T = Object.assign((s: string, v?: Record<string, unknown>) => (v ? s.replace(/{(w+)}/g, (a, k: string) => (k in v ? String(v[k]) : a)) : s), {
  rich: () => null,
  lang: "en" as const,
});

export const ET_MONTHS = [
  "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት", "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ",
];

export const CLINIC_TZ = "Africa/Addis_Ababa";

/** Year, month, day of an instant as seen on a clock in Addis Ababa. */
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { Y: get("year"), m: get("month"), d: get("day") };
}

/** Today's date in the clinic as YYYY-MM-DD. */
export function clinicToday(at = new Date()) {
  const { Y, m, d } = localParts(at);
  return `${Y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Converts a Gregorian date to the Ethiopian calendar (via Julian day number). */
export function toEthiopian(date: Date) {
  const { Y, m, d } = localParts(date);
  const a = Math.floor((14 - m) / 12);
  const y = Y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn =
    d + Math.floor((153 * mm + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;

  const offset = jdn - 1723856;
  const r = ((offset % 1461) + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year = 4 * Math.floor(offset / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
  return { year, month: Math.floor(n / 30) + 1, day: (n % 30) + 1 };
}

export function formatEthiopian(date: Date) {
  const { year, month, day } = toEthiopian(date);
  return `${ET_MONTHS[month - 1]} ${day}, ${year}`;
}

/** e.g. "5 Nov 2026 · ጥቅምት 26, 2019" */
export function formatDualDate(iso: string) {
  const d = new Date(iso);
  const greg = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: CLINIC_TZ });
  return `${greg} · ${formatEthiopian(d)}`;
}

/** Clock time in the clinic, e.g. "14:05". */
export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: CLINIC_TZ });
}

/**
 * Time between two instants, in the unit people would say: "5 min", "1 h 20 min", and from a day
 * on "1 day 3 h" or "5 days" (a visit left open overnight, not "136 h 45 min").
 */
export function formatDuration(fromIso: string, to: Date | string = new Date(), t: T = EN) {
  const mins = Math.max(0, Math.round((new Date(to).getTime() - new Date(fromIso).getTime()) / 60000));
  if (mins < 60) return t("{n} min", { n: mins });
  if (mins < 24 * 60) return t("{h} h {m} min", { h: Math.floor(mins / 60), m: mins % 60 });
  const days = Math.floor(mins / (24 * 60));
  const hours = Math.floor((mins % (24 * 60)) / 60);
  const d = t(days === 1 ? "{n} day" : "{n} days", { n: days });
  return days >= 3 || hours === 0 ? d : `${d} ${t("{n} h", { n: hours })}`;
}

/** "3 cuvettes", "1 test", "5 ml": a count with its unit, plural where English wants one. */
export function countOf(n: number, unit: string) {
  const plural = n !== 1 && unit.length > 2 && /[a-z]$/i.test(unit) && !/s$/i.test(unit);
  return `${n} ${unit}${plural ? "s" : ""}`;
}

/** Why a bill was reduced or waived (the API's categories). */
export const DISCOUNT_CATEGORIES: Record<string, string> = {
  STAFF: "Staff or their family",
  POOR: "Cannot pay (fee waiver)",
  FOLLOW_UP: "Free follow-up",
  PROGRAMME: "Free programme service (TB, HIV, family planning…)",
  GOODWILL: "Goodwill",
  OTHER: "Other",
  UNCATEGORISED: "Not categorised (before categories)",
};

/** Whether a time has passed (an expiry date, say). */
export function isPast(iso: string) {
  return new Date(iso).getTime() < Date.now();
}

/** Whole minutes from one time to another (or to now); never negative. */
export function minutesBetween(fromIso: string, to: Date | string = new Date()) {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(fromIso).getTime()) / 60_000));
}

/** A number of minutes: "42 min", "2 h 5 min", "3 h", "2 d 4 h". */
export function formatMinutes(m: number, t: T = EN) {
  if (m >= 24 * 60) {
    const h = Math.floor((m % (24 * 60)) / 60);
    return [t("{n} d", { n: Math.floor(m / (24 * 60)) }), h ? t("{n} h", { n: h }) : ""].filter(Boolean).join(" ");
  }
  return m < 60 ? t("{n} min", { n: m }) : [t("{n} h", { n: Math.floor(m / 60) }), m % 60 ? t("{n} min", { n: m % 60 }) : ""].filter(Boolean).join(" ");
}

/** Moves a YYYY-MM-DD string by a number of days. */
export function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

export const VISIT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  WAITING: { label: "Waiting", tone: "warning" },
  IN_CONSULTATION: { label: "With doctor", tone: "brand" },
  AWAITING_LAB: { label: "At lab", tone: "info" },
  AWAITING_PHARMACY: { label: "At pharmacy", tone: "violet" },
  COMPLETED: { label: "Done", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function ageFrom(iso: string | null) {
  if (!iso) return null;
  const dob = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) age--;
  return age;
}

/** Whole months from a birth date to now. */
function monthsSince(iso: string) {
  const dob = new Date(iso);
  const now = new Date();
  let m = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (now.getDate() < dob.getDate()) m--;
  return Math.max(0, m);
}

/** An age as whole years and the months beyond them. */
export function ageParts(iso: string) {
  const months = monthsSince(iso);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/**
 * Age for display: months under two years (where they matter for doses and growth), then years.
 * Short: "7m", "30y"; long: "7 months", "30 years".
 */
export function ageText(iso: string | null, short = false, t: T = EN) {
  if (!iso) return null;
  const months = monthsSince(iso);
  if (months < 24) return short ? t("{n}m", { n: months }) : t(months === 1 ? "{n} month" : "{n} months", { n: months });
  const years = Math.floor(months / 12);
  return short ? t("{n}y", { n: years }) : t("{n} years", { n: years });
}

export function fullName(p: { firstName: string; fatherName: string; grandfather?: string | null }) {
  return [p.firstName, p.fatherName, p.grandfather].filter(Boolean).join(" ");
}

/** "1,234.50 ETB" ("1,234.50 ብር" in Amharic). */
export function etb(amount: string | number, t: T = EN) {
  return t("{amount} ETB", { amount: Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
}

export const PAYMENT_METHODS: Record<string, string> = {
  CASH: "Cash",
  TELEBIRR: "Telebirr",
  CHAPA: "Chapa",
  BANK_TRANSFER: "Bank transfer",
};

export const INVOICE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Unpaid", tone: "warning" },
  PARTIALLY_PAID: { label: "Part paid", tone: "info" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Void", tone: "neutral" },
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  RECEPTIONIST: "Receptionist",
  DOCTOR: "Doctor",
  NURSE: "Nurse",
  CASHIER: "Cashier",
  PHARMACIST: "Pharmacist",
  LAB_TECH: "Lab technician",
};

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function formatAgo(iso: string | null, t: T = EN) {
  if (!iso) return t("never");
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("just now");
  if (mins < 90) return t("{n} min ago", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 36) return t("{n} h ago", { n: hours });
  return t("{n} days ago", { n: Math.round(hours / 24) });
}

/** Minutes since an instant (Infinity for none). */
export function minutesAgo(iso: string | null | undefined) {
  return iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : Infinity;
}

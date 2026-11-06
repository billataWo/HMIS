import type { BadgeTone } from "@/components/ui";

const ET_MONTHS = [
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

/** Minutes between two instants, as "5 min" or "1 h 20 min". */
export function formatDuration(fromIso: string, to: Date | string = new Date()) {
  const mins = Math.max(0, Math.round((new Date(to).getTime() - new Date(fromIso).getTime()) / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
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

export function fullName(p: { firstName: string; fatherName: string; grandfather?: string | null }) {
  return [p.firstName, p.fatherName, p.grandfather].filter(Boolean).join(" ");
}

/** "1,234.50 ETB" */
export function etb(amount: string | number) {
  return `${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
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

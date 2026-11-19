import { Badge, type BadgeTone } from "@/components/ui";
import type { SubscriptionState } from "@/lib/api";
import { CLINIC_TZ } from "@/lib/format";

const STATE: Record<SubscriptionState, { label: string; tone: BadgeTone }> = {
  trial: { label: "Trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  overdue: { label: "Overdue", tone: "warning" },
  suspended: { label: "Suspended", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function StateBadge({ state }: { state: SubscriptionState }) {
  const s = STATE[state];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: CLINIC_TZ }) : "—";

export const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: CLINIC_TZ });

export const thClass = "px-3 py-2 text-left text-xs font-medium tracking-wide text-slate-500 uppercase";
export const tdClass = "px-3 py-2.5 align-top";

export const INVOICE_STATUS = { OPEN: { label: "Open", tone: "warning" }, PAID: { label: "Paid", tone: "success" }, VOID: { label: "Void", tone: "neutral" } } as const satisfies Record<string, { label: string; tone: BadgeTone }>;
export const PAYMENT_STATUS = { PENDING: { label: "To confirm", tone: "warning" }, CONFIRMED: { label: "Confirmed", tone: "success" }, REJECTED: { label: "Rejected", tone: "neutral" } } as const satisfies Record<string, { label: string; tone: BadgeTone }>;

/** How late unpaid invoices are, in the order an accountant reads them. */
export const AGE_BUCKETS = [
  { key: "current", label: "Not yet due" },
  { key: "d1_30", label: "1–30 days late" },
  { key: "d31_60", label: "31–60 days late" },
  { key: "d61_90", label: "61–90 days late" },
  { key: "d90_plus", label: "Over 90 days late" },
] as const;

/** "1,180,000 ETB": a headline amount, rounded to the birr. */
export const birr = (amount: string | number) => `${Math.round(Number(amount)).toLocaleString("en-US")} ETB`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11" → "Nov" (or "Nov 2026" with the year). */
export const monthName = (ym: string, withYear = false) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${withYear ? ` ${ym.slice(0, 4)}` : ""}`;

/** The change from one amount to the next, as "+12%" or "−8%" (null when there is nothing to compare). */
export function change(now: number, before: number) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, text: `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%` };
}

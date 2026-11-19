import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
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
  // A tenfold jump and more reads better as "12×" than "+1100%".
  if (pct >= 1000) return { pct, text: `${Math.round(now / before)}×` };
  return { pct, text: `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%` };
}

/** This month, last month and this year, as from–to days in Addis Ababa. */
export function ranges(today: string) {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return [
    { label: "This month", from: `${y}-${pad(m)}-01`, to: today },
    { label: "Last month", from: `${prev.y}-${pad(prev.m)}-01`, to: `${prev.y}-${pad(prev.m)}-${pad(lastDay(prev.y, prev.m))}` },
    { label: "This year", from: `${y}-01-01`, to: today },
  ];
}

/** Rows per page in the console's long lists. */
export const PAGE_SIZE = 50;

/** The page number from the address (1 when missing or out of range). */
export const pageOf = (raw: string | undefined, total: number) => Math.min(Math.max(1, Math.floor(Number(raw)) || 1), Math.max(1, Math.ceil(total / PAGE_SIZE)));

/** "51–100 of 500" with Previous and Next. Nothing when everything fits on one page. */
export function Pager({ page, total, href }: { page: number; total: number; href: (page: number) => string }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const link = "inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium ring-1 ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800";
  const off = "inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium text-slate-300 ring-1 ring-slate-100 dark:text-slate-600 dark:ring-slate-800";
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-slate-500 tabular-nums">
        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={link} rel="prev">
            <ChevronLeft aria-hidden className="size-4" /> Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={off}>
            <ChevronLeft aria-hidden className="size-4" /> Previous
          </span>
        )}
        <span className="inline-flex min-h-10 items-center px-1 text-slate-500 tabular-nums">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className={link} rel="next">
            Next <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <span aria-disabled="true" className={off}>
            Next <ChevronRight aria-hidden className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}

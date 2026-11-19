import { Banknote, Download } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, Input, inputClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { clinicToday, etb } from "@/lib/format";
import { METHOD_LABEL, type PaymentLedger, platformApi } from "@/lib/platform";
import { PaymentReview } from "../../../forms";
import { date, PAYMENT_STATUS, tdClass, thClass } from "../../bits";
import { BillingTabs } from "../tabs";

type Params = { status?: string; method?: string; from?: string; to?: string; q?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** This month, last month and this year, as from–to days in Addis Ababa. */
function ranges(today: string) {
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

async function List({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const p: Params = {
    status: ["PENDING", "CONFIRMED", "REJECTED"].includes(raw.status ?? "") ? raw.status : undefined,
    method: raw.method && raw.method in METHOD_LABEL ? raw.method : undefined,
    from: raw.from && DAY.test(raw.from) ? raw.from : undefined,
    to: raw.to && DAY.test(raw.to) ? raw.to : undefined,
    q: raw.q?.trim() || undefined,
  };
  const query = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
  const { summary, payments } = await platformApi<PaymentLedger>(`/platform/payments${query.size ? `?${query}` : ""}`);
  const today = clinicToday();
  const filtered = query.size > 0;

  return (
    <>
      <form className="surface mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <label className="grid gap-1 text-xs font-medium text-slate-500 lg:col-span-2">
          Clinic, invoice or reference
          <Input name="q" defaultValue={p.q} placeholder="e.g. FT2611… or HMIS-2026-" className="w-full" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-500">
          Status
          <select name="status" defaultValue={p.status ?? ""} className={inputClass}>
            <option value="">Any</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PENDING">To confirm</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-500">
          How
          <select name="method" defaultValue={p.method ?? ""} className={inputClass}>
            <option value="">Any way</option>
            {Object.entries(METHOD_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-500">
          Paid from
          <Input name="from" type="date" defaultValue={p.from} max={today} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-500">
          to
          <Input name="to" type="date" defaultValue={p.to} max={today} />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
          <button className={secondaryButtonClass}>Show</button>
          {ranges(today).map((r) => (
            <Link
              key={r.label}
              href={`/platform/billing/payments?${new URLSearchParams({ ...(p.status && { status: p.status }), ...(p.method && { method: p.method }), from: r.from, to: r.to })}`}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-slate-200 ring-inset hover:bg-slate-50 dark:text-brand-400 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              {r.label}
            </Link>
          ))}
          {filtered && (
            <Link href="/platform/billing/payments" className="px-2 text-sm font-medium text-slate-600 hover:underline dark:text-slate-300">
              Clear
            </Link>
          )}
          <a href={`/platform/billing/csv/payments${query.size ? `?${query}` : ""}`} className={`${secondaryButtonClass} ml-auto gap-2`}>
            <Download aria-hidden className="size-4" /> CSV
          </a>
        </div>
      </form>

      <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-slate-500">Payments</dt>
          <dd className="text-lg font-semibold tabular-nums">{summary.count}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Received (confirmed)</dt>
          <dd className="text-lg font-semibold tabular-nums">{etb(summary.confirmed)}</dd>
        </div>
        {summary.pending > 0 && (
          <div>
            <dt className="text-slate-500">To confirm</dt>
            <dd className="text-lg font-semibold text-amber-700 tabular-nums dark:text-amber-300">{summary.pending}</dd>
          </div>
        )}
      </dl>

      {!payments.length ? (
        <EmptyState icon={Banknote} title={filtered ? "No payment matches" : "No payments yet"}>
          Payments appear here when a clinic pays online, reports a bank transfer, or you record one.
        </EmptyState>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/60">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className={thClass}>Paid on</th>
                <th className={thClass}>Clinic</th>
                <th className={thClass}>Invoice</th>
                <th className={`${thClass} text-right`}>Amount</th>
                <th className={thClass}>How</th>
                <th className={thClass}>Reference</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {payments.map((x) => (
                <tr key={x.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <td className={`${tdClass} whitespace-nowrap`}>{date(x.paidAt)}</td>
                  <td className={tdClass}>
                    <Link href={`/platform/clinics/${x.tenantId}`} className="font-medium hover:underline">
                      {x.clinic}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <Link href={`/platform/invoice/${x.invoiceId}`} className="font-mono text-brand-700 hover:underline dark:text-brand-400">
                      {x.invoice.number}
                    </Link>
                  </td>
                  <td className={`${tdClass} text-right font-medium tabular-nums`}>{etb(x.amount)}</td>
                  <td className={tdClass}>{METHOD_LABEL[x.method] ?? x.method}</td>
                  <td className={`${tdClass} max-w-48 truncate font-mono text-xs`} title={x.reference ?? undefined}>
                    {x.reference ?? "—"}
                  </td>
                  <td className={tdClass}>
                    {x.status === "PENDING" ? (
                      <PaymentReview paymentId={x.id} />
                    ) : (
                      <>
                        <Badge tone={PAYMENT_STATUS[x.status].tone}>{PAYMENT_STATUS[x.status].label}</Badge>
                        <p className="mt-0.5 text-xs text-slate-500">{x.rejectReason ?? (x.reviewedBy ? `by ${x.reviewedBy}` : x.method === "CHAPA" || x.method === "TELEBIRR" ? "by the provider" : "")}</p>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments.length === 1000 && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">The latest 1,000: choose dates to see older ones.</p>}
        </div>
      )}
    </>
  );
}

export default function PaymentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <PageHeader title="Billing" subtitle="Every invoice HMIS has issued and every payment received, across all clinics." />
      <BillingTabs current="/platform/billing/payments" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

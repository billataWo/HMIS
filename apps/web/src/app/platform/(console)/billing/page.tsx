import { ChevronRight, Download, FileText, Printer, Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, Input, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { etb } from "@/lib/format";
import { type InvoiceLedger, type LedgerInvoice, type Metrics, platformApi } from "@/lib/platform";
import { AGE_BUCKETS, date, INVOICE_STATUS, thClass } from "../bits";
import { BillingTabs } from "./tabs";

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/** What clinics owe, by how late it is: the accountant's first question. */
async function Ageing() {
  const m = await platformApi<Metrics>("/platform/metrics");
  const total = Number(m.receivables.total);
  return (
    <section aria-labelledby="owed" className="surface mb-6 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="owed" className="text-sm font-medium text-slate-500">
          Clinics owe
        </h2>
        <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{etb(m.receivables.total)}</p>
      </div>
      {total > 0 && (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
          {AGE_BUCKETS.map((b, i) => {
            const share = Number(m.receivables.ageing[b.key].amount) / total;
            return share > 0 ? <span key={b.key} className={`h-full ${["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-red-500", "bg-red-700"][i]}`} style={{ width: `${share * 100}%` }} /> : null;
          })}
        </div>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {AGE_BUCKETS.map((b, i) => {
          const v = m.receivables.ageing[b.key];
          return (
            <div key={b.key}>
              <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                <span aria-hidden className={`size-2 rounded-full ${["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-red-500", "bg-red-700"][i]}`} />
                {b.label}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900 tabular-nums dark:text-white">{etb(v.amount)}</dd>
              <dd className="text-xs text-slate-500">
                {v.count} invoice{v.count === 1 ? "" : "s"}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** The clinic said it would pay by a day: kept to, or broken once the day has passed. */
function PromiseToPay({ p }: { p: LedgerInvoice["promise"] }) {
  if (!p) return null;
  return (
    <p className={`text-xs font-medium ${p.broken ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
      {p.broken ? "promise broken" : "promised"} {date(p.on)}
    </p>
  );
}

async function List({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const params = await searchParams;
  const status: Filter = FILTERS.some((f) => f.value === params.status) ? (params.status as Filter) : "ALL";
  const q = params.q?.trim() ?? "";
  const query = new URLSearchParams({ ...(status !== "ALL" && { status }), ...(q && { q }) });
  const { summary, invoices } = await platformApi<InvoiceLedger>(`/platform/invoices${query.size ? `?${query}` : ""}`);
  const count = (f: Filter) =>
    f === "ALL" ? (summary.OPEN?.count ?? 0) + (summary.PAID?.count ?? 0) + (summary.VOID?.count ?? 0) : f === "OVERDUE" ? summary.OVERDUE.count : (summary[f]?.count ?? 0);
  const href = (f: Filter) => `/platform/billing?${new URLSearchParams({ ...(f !== "ALL" && { status: f }), ...(q && { q }) })}`;
  const totals = invoices.reduce((t, i) => ({ total: t.total + Number(i.total), balance: t.balance + Number(i.balance) }), { total: 0, balance: 0 });

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Filter by status" className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => {
            const on = status === f.value;
            return (
              <Link
                key={f.value}
                href={href(f.value)}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-colors ring-inset ${
                  on
                    ? "bg-brand-700 text-white ring-brand-700"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                {f.label}
                <span className={`text-xs tabular-nums ${on ? "text-white/80" : f.value === "OVERDUE" && count(f.value) ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-500"}`}>
                  {count(f.value)}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="flex gap-2">
          <form role="search" className="flex flex-1 gap-2 lg:w-80 lg:flex-none">
            {status !== "ALL" && <input type="hidden" name="status" value={status} />}
            <div className="relative flex-1">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input name="q" defaultValue={q} placeholder="Invoice number or clinic" aria-label="Search invoices" className="w-full pl-9" />
            </div>
          </form>
          <a href={`/platform/billing/csv/invoices${query.size ? `?${query}` : ""}`} className={`${secondaryButtonClass} gap-2`} title="Download these invoices as a spreadsheet">
            <Download aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">CSV</span>
          </a>
        </div>
      </div>

      {!invoices.length ? (
        <EmptyState icon={FileText} title={q ? `No invoice matches “${q}”` : "No invoices here"}>
          {status === "OVERDUE" ? "Every open invoice is within its due date." : "Invoices are issued from each clinic's page, or by themselves before a period ends."}
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {invoices.map((i) => (
              <li key={i.id} className="surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/platform/clinics/${i.tenantId}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                      {i.clinic}
                    </Link>
                    <p className="font-mono text-xs text-slate-500">{i.number}</p>
                  </div>
                  <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                </div>
                <p className="mt-2 flex items-baseline justify-between text-sm">
                  <span className="text-slate-500">
                    {i.status === "OPEN" ? (i.daysLate ? <span className="font-medium text-red-700 dark:text-red-400">{i.daysLate} days late</span> : `due ${date(i.dueDate)}`) : date(i.issuedAt)}
                  </span>
                  <span className="font-semibold tabular-nums">{etb(i.status === "OPEN" ? i.balance : i.total)}</span>
                </p>
                <PromiseToPay p={i.promise} />
                <Link href={`/platform/invoice/${i.id}`} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
                  <Printer aria-hidden className="size-4" /> View and print
                </Link>
              </li>
            ))}
          </ul>

          <div className="surface hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={thClass}>Invoice</th>
                  <th className={thClass}>Clinic</th>
                  <th className={thClass}>Period</th>
                  <th className={thClass}>Due</th>
                  <th className={`${thClass} text-right`}>Total</th>
                  <th className={`${thClass} text-right`}>Balance</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoices.map((i) => (
                  <tr key={i.id} className="relative transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <td className="px-3 py-3 align-top whitespace-nowrap">
                      <Link
                        href={`/platform/invoice/${i.id}`}
                        className="font-mono font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-600 focus-visible:after:ring-inset dark:text-white"
                      >
                        {i.number}
                      </Link>
                      <p className="text-xs text-slate-500">issued {date(i.issuedAt)}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Link href={`/platform/clinics/${i.tenantId}`} className="relative z-10 font-medium hover:underline">
                        {i.clinic}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {i.planName} · {i.cycle === "YEARLY" ? "yearly" : "monthly"}
                      </p>
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {date(i.periodStart)} – {date(i.periodEnd)}
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap">
                      {date(i.dueDate)}
                      {i.status === "OPEN" && i.daysLate > 0 && <p className="text-xs font-medium text-red-700 dark:text-red-400">{i.daysLate} days late</p>}
                      {i.status === "PAID" && i.paidAt && <p className="text-xs text-slate-500">paid {date(i.paidAt)}</p>}
                      <PromiseToPay p={i.promise} />
                    </td>
                    <td className="px-3 py-3 text-right align-top tabular-nums">{etb(i.total)}</td>
                    <td className="px-3 py-3 text-right align-top font-medium tabular-nums">{i.status === "OPEN" ? etb(i.balance) : "—"}</td>
                    <td className="px-3 py-3 align-top">
                      <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                    </td>
                    <td className="px-3 py-3 align-top text-slate-500">
                      <ChevronRight aria-hidden className="size-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-medium dark:border-slate-800 dark:bg-slate-900/60">
                <tr>
                  <td className="px-3 py-2.5" colSpan={4}>
                    {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
                    {invoices.length === 500 && <span className="font-normal text-slate-500"> (the latest 500: narrow the search to see older ones)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{etb(totals.total)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{etb(totals.balance)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  return (
    <>
      <PageHeader title="Billing" subtitle="Every invoice HMIS has issued and every payment received, across all clinics." />
      <BillingTabs current="/platform/billing" />
      <Suspense fallback={<Skeleton className="mb-6 h-36" />}>
        <Ageing />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

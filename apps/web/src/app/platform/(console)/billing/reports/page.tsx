import { Download, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, Input, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { clinicToday, etb } from "@/lib/format";
import { platformApi, type SalesReport, type VatRegister } from "@/lib/platform";
import { date, INVOICE_STATUS, monthName, ranges, thClass } from "../../bits";
import { BillingTabs } from "../tabs";

export const metadata: Metadata = { title: "Billing reports" };

type Params = { year?: string; from?: string; to?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tdNum = "px-3 py-2 text-right tabular-nums";
const csvLink = (href: string, title: string) => (
  <a href={href} className={`${secondaryButtonClass} gap-2`} title={title}>
    <Download aria-hidden className="size-4" />
    <span className="sr-only sm:not-sr-only">CSV</span>
  </a>
);

/** Invoiced (by the day issued) and collected (by the day paid), month by month. */
async function Sales({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const year = raw.year && /^\d{4}$/.test(raw.year) ? raw.year : "";
  const r = await platformApi<SalesReport>(`/platform/reports/sales${year ? `?year=${year}` : ""}`);
  const keep = (y: number) => new URLSearchParams({ year: String(y), ...(raw.from && { from: raw.from }), ...(raw.to && { to: raw.to }) });
  return (
    <Card
      title={`Invoiced and collected in ${r.year}`}
      description="Invoiced by the day each invoice was issued (voided ones left out); collected by the day the money was paid."
      actions={
        <div className="flex items-center gap-2">
          <nav aria-label="Year" className="flex gap-1">
            {r.years.map((y) => (
              <Link
                key={y}
                href={`/platform/billing/reports?${keep(y)}`}
                aria-current={y === r.year ? "page" : undefined}
                className="rounded-full px-2.5 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 aria-[current]:bg-brand-700 aria-[current]:text-white aria-[current]:ring-brand-700 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              >
                {y}
              </Link>
            ))}
          </nav>
          {csvLink(`/platform/billing/csv/sales?year=${r.year}`, "Download the months as a spreadsheet")}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="-m-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/60">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className={thClass}>Month</th>
              <th className={`${thClass} text-right`}>Invoices</th>
              <th className={`${thClass} text-right`}>Before VAT</th>
              <th className={`${thClass} text-right`}>VAT</th>
              <th className={`${thClass} text-right`}>Invoiced</th>
              <th className={`${thClass} text-right`}>Collected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {r.months.map((m) => {
              const empty = !m.invoices && !Number(m.collected) && !m.voided;
              return (
                <tr key={m.month} className={empty ? "text-slate-400 dark:text-slate-600" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/platform/billing/reports?${new URLSearchParams({ year: String(r.year), from: `${m.month}-01`, to: monthEnd(m.month) })}#register`} className="font-medium hover:underline">
                      {monthName(m.month, true)}
                    </Link>
                  </td>
                  <td className={tdNum}>
                    {m.invoices}
                    {m.voided > 0 && <span className="ml-1 text-xs text-slate-500">(+{m.voided} void)</span>}
                  </td>
                  <td className={tdNum}>{num(m.subtotal)}</td>
                  <td className={tdNum}>{num(m.vat)}</td>
                  <td className={`${tdNum} font-medium`}>{num(m.total)}</td>
                  <td className={tdNum}>{num(m.collected)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold dark:border-slate-800 dark:bg-slate-900/60">
            <tr>
              <td className="px-3 py-2.5">{r.year}</td>
              <td className={tdNum}>{r.totals.invoices}</td>
              <td className={tdNum}>{num(r.totals.subtotal)}</td>
              <td className={tdNum}>{num(r.totals.vat)}</td>
              <td className={tdNum}>{num(r.totals.total)}</td>
              <td className={tdNum}>{num(r.totals.collected)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/** The last day of a month (YYYY-MM). */
const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Rows shown on the page; the CSV has them all. */
const SHOWN = 300;

/** The VAT sales register for a period: every invoice issued, with the buyer's TIN. */
async function Register({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  await connection();
  const today = clinicToday();
  const from = raw.from && DAY.test(raw.from) ? raw.from : `${today.slice(0, 7)}-01`;
  const to = raw.to && DAY.test(raw.to) ? raw.to : today;
  const r = await platformApi<VatRegister>(`/platform/reports/vat-register?from=${from}&to=${to}`);
  const keepYear: Record<string, string> = raw.year ? { year: raw.year } : {};
  return (
    <Card
      title="VAT sales register"
      description="Every invoice issued in the period with the clinic's TIN, for the VAT return. Voided invoices are listed and count for nothing."
      actions={csvLink(`/platform/billing/csv/vat-register?from=${r.period.from}&to=${r.period.to}`, "Download the register as a spreadsheet")}
    >
      <div id="register" className="scroll-mt-24 space-y-4">
        <form className="flex flex-wrap items-end gap-2">
          {raw.year && <input type="hidden" name="year" value={raw.year} />}
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">From</span>
            <Input type="date" name="from" defaultValue={r.period.from} className="w-40" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">To</span>
            <Input type="date" name="to" defaultValue={r.period.to} className="w-40" />
          </label>
          <button className={secondaryButtonClass}>Show</button>
          <span className="flex flex-wrap gap-1 sm:ml-auto">
            {ranges(today).map((p) => (
              <Link
                key={p.label}
                href={`/platform/billing/reports?${new URLSearchParams({ ...keepYear, from: p.from, to: p.to })}#register`}
                aria-current={p.from === r.period.from && p.to === r.period.to ? "true" : undefined}
                className="rounded-full px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 aria-[current]:bg-brand-700 aria-[current]:text-white aria-[current]:ring-brand-700 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              >
                {p.label}
              </Link>
            ))}
          </span>
        </form>

        <dl className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-4 dark:bg-slate-900">
          {(
            [
              ["Invoices", String(r.totals.invoices) + (r.totals.voided ? ` (+${r.totals.voided} void)` : "")],
              ["Before VAT", etb(r.totals.subtotal)],
              ["VAT", etb(r.totals.vat)],
              ["Total", etb(r.totals.total)],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="mt-0.5 font-semibold text-slate-900 tabular-nums dark:text-white">{v}</dd>
            </div>
          ))}
        </dl>
        {r.totals.withoutTin > 0 && (
          <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {r.totals.withoutTin} invoice{r.totals.withoutTin === 1 ? " is" : "s are"} to clinics with no TIN on record. The clinic&apos;s admin adds it in Settings.
          </p>
        )}

        {!r.invoices.length ? (
          <p className="text-sm text-slate-500">No invoices issued in this period.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="border-y border-slate-200 dark:border-slate-800">
                  <th className={thClass}>Issued</th>
                  <th className={thClass}>Invoice</th>
                  <th className={thClass}>Clinic</th>
                  <th className={thClass}>TIN</th>
                  <th className={`${thClass} text-right`}>Before VAT</th>
                  <th className={`${thClass} text-right`}>VAT</th>
                  <th className={`${thClass} text-right`}>Total</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {r.invoices.slice(0, SHOWN).map((i) => {
                  const off = i.status === "VOID";
                  return (
                    <tr key={i.id} className={off ? "text-slate-400 dark:text-slate-500" : ""}>
                      <td className="px-3 py-2 whitespace-nowrap">{date(i.issuedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={`/platform/invoice/${i.id}`} className="font-mono font-medium hover:underline">
                          {i.number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/platform/clinics/${i.tenantId}`} className="hover:underline">
                          {i.clinic}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{i.tin ?? <span className="font-sans text-amber-700 dark:text-amber-400">none</span>}</td>
                      <td className={`${tdNum} ${off ? "line-through" : ""}`}>{num(i.subtotal)}</td>
                      <td className={`${tdNum} ${off ? "line-through" : ""}`}>{num(i.vat)}</td>
                      <td className={`${tdNum} ${off ? "line-through" : ""}`}>{num(i.total)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {r.invoices.length > SHOWN && (
              <p className="border-t border-slate-200 px-5 py-3 text-sm text-slate-500 dark:border-slate-800">
                The first {SHOWN} of {r.invoices.length} are shown; the totals above count them all. Download the CSV for every line.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <PageHeader title="Billing" subtitle="Every invoice HMIS has issued and every payment received, across all clinics." />
      <BillingTabs current="/platform/billing/reports" />
      <div className="space-y-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Sales searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Register searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}

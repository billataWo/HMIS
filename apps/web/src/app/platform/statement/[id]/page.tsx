import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Input, secondaryButtonClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { CLINIC_TZ, clinicToday, etb } from "@/lib/format";
import { METHOD_LABEL, platformApi, type Statement } from "@/lib/platform";
import { ranges } from "../../(console)/bits";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Statement of account" };

type Params = { from?: string; to?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: CLINIC_TZ });
/** "2026-11-19" as "19 November 2026". */
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const amount = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A balance as the clinic reads it: what it owes, or what it has paid ahead ("in credit"). */
const owed = (v: string) => (Number(v) < 0 ? `${amount(String(-Number(v)))} CR` : amount(v));

/**
 * Everything HMIS billed a clinic and everything it paid over a period, with a running balance:
 * what an accountant asks for at the end of the year, or before a dispute. Printed or saved as PDF.
 */
async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams({ ...(raw.from && DAY.test(raw.from) && { from: raw.from }), ...(raw.to && DAY.test(raw.to) && { to: raw.to }) });
  let s: Statement;
  try {
    s = await platformApi<Statement>(`/platform/clinics/${id}/statement${query.size ? `?${query}` : ""}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  await connection();
  const today = clinicToday();
  const joined = clinicToday(new Date(s.clinic.createdAt));
  const presets = [{ label: "Since joining", from: joined, to: today }, ...ranges(today).filter((r) => r.label !== "This month"), { label: "Last year", from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: `${Number(today.slice(0, 4)) - 1}-12-31` }];
  const closing = Number(s.closing);
  const { issuer } = s;

  return (
    <>
      <div className="mx-auto mb-4 max-w-[210mm] space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/platform/clinics/${s.clinic.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            <ArrowLeft aria-hidden className="size-4" /> {s.clinic.name}
          </Link>
          <PrintButton />
        </div>
        <form className="flex flex-wrap items-end gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">From</span>
            <Input type="date" name="from" defaultValue={s.period.from} max={today} className="w-40" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">To</span>
            <Input type="date" name="to" defaultValue={s.period.to} max={today} className="w-40" />
          </label>
          <button className={secondaryButtonClass}>Show</button>
          <span className="flex flex-wrap gap-1 sm:ml-auto">
            {presets.map((r) => (
              <Link
                key={r.label}
                href={`?from=${r.from}&to=${r.to}`}
                aria-current={r.from === s.period.from && r.to === s.period.to ? "true" : undefined}
                className="rounded-full px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 aria-[current]:bg-brand-700 aria-[current]:text-white aria-[current]:ring-brand-700 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              >
                {r.label}
              </Link>
            ))}
          </span>
        </form>
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-lg font-bold tracking-tight">{issuer.companyName ?? "HMIS"}</p>
            {issuer.companyAddress && <p className="text-slate-600">{issuer.companyAddress}</p>}
            {issuer.companyTin && <p className="text-slate-600">TIN {issuer.companyTin}</p>}
            <p className="text-slate-600">{[issuer.supportPhone, issuer.supportEmail].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-semibold tracking-tight">Statement of account</h1>
            <p className="text-slate-600">
              {longDay(s.period.from)} – {longDay(s.period.to)}
            </p>
            <p className="text-xs text-slate-500">Printed {longDay(today)}</p>
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-200 py-6 sm:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Account</h2>
            <p className="mt-1 font-semibold">{s.clinic.name}</p>
            {s.clinic.nameAm && <p>{s.clinic.nameAm}</p>}
            {s.clinic.address && <p className="text-slate-600">{s.clinic.address}</p>}
            {s.clinic.phone && <p className="text-slate-600">Tel {s.clinic.phone}</p>}
            {s.clinic.tin && <p className="text-slate-600">TIN {s.clinic.tin}</p>}
          </div>
          <dl className="grid grid-cols-[auto_auto] content-start gap-x-6 gap-y-1 tabular-nums sm:text-right">
            <dt className="text-slate-600">Opening balance</dt>
            <dd>{owed(s.opening)}</dd>
            <dt className="text-slate-600">Invoiced</dt>
            <dd>{amount(s.totals.invoiced)}</dd>
            <dt className="text-slate-600">Paid</dt>
            <dd>− {amount(s.totals.paid)}</dd>
            <dt className="border-t border-slate-900 pt-1 font-semibold">{closing < 0 ? "In credit" : "Balance due"}</dt>
            <dd className="border-t border-slate-900 pt-1 font-semibold">{etb(String(Math.abs(closing)))}</dd>
          </dl>
        </section>

        <table className="mt-6 w-full">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left text-xs tracking-wider text-slate-500 uppercase">
              <th className="py-2 pr-2 font-semibold">Date</th>
              <th className="py-2 pr-2 font-semibold">Details</th>
              <th className="py-2 pr-2 text-right font-semibold">Charges</th>
              <th className="py-2 pr-2 text-right font-semibold">Payments</th>
              <th className="py-2 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 tabular-nums">
            <tr className="text-slate-600">
              <td className="py-2 pr-2 whitespace-nowrap">{day(`${s.period.from}T00:00:00+03:00`)}</td>
              <td className="py-2 pr-2" colSpan={3}>
                Opening balance
              </td>
              <td className="py-2 text-right">{owed(s.opening)}</td>
            </tr>
            {s.lines.map((l) => (
              <tr key={`${l.kind}-${l.id}`} className="align-top break-inside-avoid">
                <td className="py-2 pr-2 whitespace-nowrap">{day(l.at)}</td>
                <td className="py-2 pr-2">
                  {l.kind === "INVOICE" ? (
                    <>
                      <span className="font-medium">Invoice </span>
                      <Link href={`/platform/invoice/${l.id}`} className="font-mono font-medium hover:underline">
                        {l.reference}
                      </Link>
                      <span className="block text-xs text-slate-600">{l.description}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{l.description}</span>
                      <span className="block text-xs text-slate-600">
                        {[l.method ? (METHOD_LABEL[l.method] ?? l.method) : null, l.reference ? `ref ${l.reference}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </>
                  )}
                </td>
                <td className="py-2 pr-2 text-right">{Number(l.debit) ? amount(l.debit) : ""}</td>
                <td className="py-2 pr-2 text-right">{Number(l.credit) ? amount(l.credit) : ""}</td>
                <td className="py-2 text-right">{owed(l.balance)}</td>
              </tr>
            ))}
            {!s.lines.length && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  Nothing invoiced or paid in this period.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-900 font-semibold tabular-nums">
              <td className="py-2 pr-2" colSpan={2}>
                Closing balance, {longDay(s.period.to)}
              </td>
              <td className="py-2 pr-2 text-right">{amount(s.totals.invoiced)}</td>
              <td className="py-2 pr-2 text-right">{amount(s.totals.paid)}</td>
              <td className="py-2 text-right">{owed(s.closing)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-2 text-xs text-slate-500">Amounts in birr (ETB), VAT included. CR: paid ahead, in the clinic&apos;s favour. Voided invoices are left out.</p>

        {s.open.length > 0 && (
          <section className="mt-8 break-inside-avoid">
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Unpaid invoices today</h2>
            <table className="mt-2 w-full tabular-nums">
              <tbody className="divide-y divide-slate-200">
                {s.open.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1.5 font-mono">{i.number}</td>
                    <td className="py-1.5">due {day(i.dueDate)}</td>
                    <td className={`py-1.5 ${i.daysLate ? "font-medium text-red-700" : "text-slate-600"}`}>{i.daysLate ? `${i.daysLate} day${i.daysLate === 1 ? "" : "s"} late` : "not yet due"}</td>
                    <td className="py-1.5 text-right font-medium">{etb(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {issuer.bankDetails && (
              <div className="mt-4 rounded-lg border border-slate-200 p-4">
                <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">How to pay</h3>
                <p className="mt-1">Online with Chapa or telebirr in HMIS (Settings → Subscription), or by bank transfer quoting the invoice number:</p>
                <p className="mt-1 whitespace-pre-line">{issuer.bankDetails}</p>
              </div>
            )}
          </section>
        )}

        <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500">
          Please tell us within 30 days if anything on this statement looks wrong.
          {issuer.supportPhone || issuer.supportEmail ? ` ${[issuer.supportPhone, issuer.supportEmail].filter(Boolean).join(" or ")}.` : ""}
        </footer>
      </article>
    </>
  );
}

export default function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  return (
    <main className="flex-1 bg-slate-100 px-4 py-6 sm:py-10 print:bg-white print:p-0 dark:bg-slate-950">
      <Suspense fallback={<div className="mx-auto h-[297mm] max-w-[210mm] animate-pulse bg-white" />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

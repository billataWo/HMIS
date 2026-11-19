import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ApiError } from "@/lib/api";
import { CLINIC_TZ, clinicToday, etb } from "@/lib/format";
import { DEPLOYMENT_LABEL, type InvoiceDocument, METHOD_LABEL, platformApi } from "@/lib/platform";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Invoice" };

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: CLINIC_TZ }) : "—");

/**
 * HMIS's invoice to a clinic, as a document: A4, the seller and buyer with their TINs, the
 * subscription period, VAT, what has been paid and how to pay the rest. Printed or saved as PDF
 * from the browser, to send to the clinic or the accountant.
 */
async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let doc: InvoiceDocument;
  try {
    doc = await platformApi<InvoiceDocument>(`/platform/invoices/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { invoice: i, clinic, issuer } = doc;
  // Late from the day after the due date (calendar days in Addis Ababa, as in the ledger).
  const overdue = i.status === "OPEN" && clinicToday() > clinicToday(new Date(i.dueDate));
  // The rate on the invoice itself: the setting may have changed since it was issued.
  const vatRate = Number(i.subtotal) ? Math.round((Number(i.vat) / Number(i.subtotal)) * 10_000) / 100 : Number(issuer.vatPercent);
  const stamp = i.status === "PAID" ? { text: "PAID", cls: "border-emerald-600 text-emerald-700" } : i.status === "VOID" ? { text: "VOID", cls: "border-slate-500 text-slate-600" } : overdue ? { text: "OVERDUE", cls: "border-red-600 text-red-700" } : null;
  const received = i.payments.filter((p) => p.status === "CONFIRMED");

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/platform/clinics/${i.tenantId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
          <ArrowLeft aria-hidden className="size-4" /> {clinic.name}
        </Link>
        <PrintButton />
      </div>

      <article className="relative mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">

        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-lg font-bold tracking-tight">{issuer.companyName ?? "HMIS"}</p>
            {issuer.companyAddress && <p className="text-slate-600">{issuer.companyAddress}</p>}
            {issuer.companyTin && <p className="text-slate-600">TIN {issuer.companyTin}</p>}
            <p className="text-slate-600">{[issuer.supportPhone, issuer.supportEmail].filter(Boolean).join(" · ")}</p>
            {issuer.publicUrl && <p className="text-slate-600">{issuer.publicUrl.replace(/^https?:\/\//, "")}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-semibold tracking-tight">{issuer.companyTin && Number(i.vat) > 0 ? "Tax invoice" : "Invoice"}</h1>
            <p className="font-mono text-base font-semibold">{i.number}</p>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 text-slate-600">
              <dt>Issued</dt>
              <dd className="text-slate-900">{day(i.issuedAt)}</dd>
              <dt>Due</dt>
              <dd className={overdue ? "font-semibold text-red-700" : "text-slate-900"}>{day(i.dueDate)}</dd>
              {i.paidAt && (
                <>
                  <dt>Paid</dt>
                  <dd className="text-slate-900">{day(i.paidAt)}</dd>
                </>
              )}
            </dl>
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-200 py-6 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Bill to</h2>
            <p className="mt-1 font-semibold">{clinic.name}</p>
            {clinic.nameAm && <p>{clinic.nameAm}</p>}
            {clinic.address && <p className="text-slate-600">{clinic.address}</p>}
            {clinic.phone && <p className="text-slate-600">Tel {clinic.phone}</p>}
            {clinic.tin && <p className="text-slate-600">TIN {clinic.tin}</p>}
          </div>
          <div className="sm:text-right">
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Service period</h2>
            <p className="mt-1 font-semibold">
              {day(i.periodStart)} – {day(i.periodEnd)}
            </p>
            <p className="text-slate-600">
              {i.cycle === "YEARLY" ? "Yearly" : "Monthly"} subscription · {DEPLOYMENT_LABEL[i.deployment]}
            </p>
          </div>
        </section>

        <table className="mt-6 w-full">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left text-xs tracking-wider text-slate-500 uppercase">
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              <th className="py-2 text-right font-semibold">Amount (ETB)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200 align-top">
              <td className="py-3">
                <p className="font-medium">HMIS {i.planName} plan</p>
                <p className="text-slate-600">
                  {i.cycle === "YEARLY" ? "One year" : "One month"} of the hospital management system, {day(i.periodStart)} to {day(i.periodEnd)}
                </p>
              </td>
              <td className="py-3 text-right tabular-nums">1</td>
              <td className="py-3 text-right tabular-nums">{Number(i.subtotal).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        {stamp ? (
          <p className={`mt-4 ml-2 rotate-[-8deg] rounded-md border-4 px-4 py-1 text-2xl font-black tracking-[0.2em] opacity-80 ${stamp.cls}`}>{stamp.text}</p>
        ) : (
          <span />
        )}
        <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 tabular-nums">
          <dt className="text-slate-600">Subtotal</dt>
          <dd className="text-right">{etb(i.subtotal)}</dd>
          <dt className="text-slate-600">VAT ({vatRate}%)</dt>
          <dd className="text-right">{etb(i.vat)}</dd>
          <div className="col-span-2 flex justify-between border-t border-slate-900 pt-1.5 font-semibold">
            <dt>Total</dt>
            <dd>{etb(i.total)}</dd>
          </div>
          {Number(i.paid) > 0 && (
            <>
              <dt className="text-slate-600">Paid</dt>
              <dd className="text-right">− {etb(i.paid)}</dd>
            </>
          )}
          {i.status === "OPEN" && (
            <div className="col-span-2 mt-1 flex justify-between rounded-md bg-slate-100 px-2 py-1.5 font-semibold">
              <dt>Balance due</dt>
              <dd>{etb(i.balance)}</dd>
            </div>
          )}
        </dl>
        </div>

        {i.status === "VOID" && (
          <p className="mt-6 rounded-md bg-slate-100 px-3 py-2 text-slate-700">
            This invoice was voided{i.voidedAt ? ` on ${day(i.voidedAt)}` : ""}: nothing is owed on it.{i.voidReason ? ` Reason: ${i.voidReason}.` : ""}
          </p>
        )}

        {received.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Payments received</h2>
            <table className="mt-2 w-full">
              <tbody className="divide-y divide-slate-200">
                {received.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5">{day(p.paidAt)}</td>
                    <td className="py-1.5">{METHOD_LABEL[p.method] ?? p.method}</td>
                    <td className="py-1.5 font-mono text-xs">{p.reference ?? ""}</td>
                    <td className="py-1.5 text-right tabular-nums">{etb(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {i.status === "OPEN" && (
          <section className="mt-8 grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
            <div>
              <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">How to pay</h2>
              <p className="mt-1">
                Online with Chapa or telebirr: in HMIS, <span className="font-medium">Settings → Subscription</span>.
              </p>
              <p className="mt-1">By bank transfer: quote the invoice number {i.number}, then report the transfer in the same place.</p>
            </div>
            {issuer.bankDetails && (
              <div>
                <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Bank account</h2>
                <p className="mt-1 whitespace-pre-line">{issuer.bankDetails}</p>
              </div>
            )}
          </section>
        )}

        <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500">
          Thank you for using HMIS.{issuer.supportPhone || issuer.supportEmail ? ` Questions about this invoice: ${[issuer.supportPhone, issuer.supportEmail].filter(Boolean).join(" or ")}.` : ""}
        </footer>
      </article>
    </>
  );
}

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="flex-1 bg-slate-100 px-4 py-6 sm:py-10 print:bg-white print:p-0 dark:bg-slate-950">
      <Suspense fallback={<div className="mx-auto h-[297mm] max-w-[210mm] animate-pulse bg-white" />}>
        <Invoice params={params} />
      </Suspense>
    </main>
  );
}

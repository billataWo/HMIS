import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PrintButton } from "@/components/print-button";
import { inputClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Me, type PayerStatement, type StatementInvoice } from "@/lib/api";
import { etb, formatDualDate, fullName } from "@/lib/format";
import { PayerForm, SettlementForm } from "../payer-forms";

function InvoiceTable({ rows }: { rows: StatementInvoice[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-500">
        <tr>
          <th className="py-2 pr-3">Date</th>
          <th className="py-2 pr-3">Invoice</th>
          <th className="py-2 pr-3">Patient</th>
          <th className="py-2 pr-3">Services</th>
          <th className="py-2 pr-3 text-right">Total</th>
          <th className="py-2 pr-3 text-right">Balance</th>
          <th className="py-2 print:hidden">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.id} className="border-t border-slate-100 align-top dark:border-slate-800">
            <td className="py-2 pr-3 whitespace-nowrap">{formatDualDate(i.createdAt)}</td>
            <td className="py-2 pr-3 font-mono text-xs">
              <Link href={`/billing/invoices/${i.id}`} className="hover:underline">
                {i.number}
              </Link>
            </td>
            <td className="py-2 pr-3">
              {fullName(i.patient)}
              <span className="block text-xs text-slate-500">{i.patient.mrn}</span>
            </td>
            <td className="py-2 pr-3 text-xs text-slate-600 dark:text-slate-400">{i.charges.map((c) => (c.quantity > 1 ? `${c.description} ×${c.quantity}` : c.description)).join(", ")}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{etb(i.total)}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{etb(i.balance)}</td>
            <td className="py-2 print:hidden">
              <InvoiceBadge status={i.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Statement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const range = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  let s: PayerStatement;
  let me: Me;
  try {
    [s, me] = await Promise.all([api<PayerStatement>(`/payers/${id}/statement?${range}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <>
      <PageHeader
        title={s.payer.name}
        subtitle={`${s.payer.type === "CREDIT" ? "Credit" : "Insurance"} · ${[s.payer.contactPerson, s.payer.phone].filter(Boolean).join(" · ") || "no contact recorded"}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {me.role === "ADMIN" && <PayerForm payer={s.payer} />}
            <PrintButton inline />
          </div>
        }
      />
      <div className="space-y-6">
        <div className="hidden text-sm print:block">
          <p className="font-bold">{s.tenant.name}</p>
          <p>{[s.tenant.address, s.tenant.phone].filter(Boolean).join(" · ")}</p>
          <p className="mt-2 font-semibold">STATEMENT OF ACCOUNT</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
          <div className="surface p-4">
            <p className="text-sm text-slate-500">Billed {s.from === s.to ? formatDualDate(`${s.from}T12:00:00+03:00`) : `${formatDualDate(`${s.from}T12:00:00+03:00`)} – ${formatDualDate(`${s.to}T12:00:00+03:00`)}`}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{etb(s.billed)}</p>
          </div>
          <div className="surface p-4">
            <p className="text-sm text-slate-500">Total still owed (all periods)</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${Number(s.balance) > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{etb(s.balance)}</p>
          </div>
        </div>

        {Number(s.balance) > 0 && (
          <section className="surface p-5 print:hidden">
            <h2 className="mb-3 font-semibold">Record a payment from {s.payer.name}</h2>
            <SettlementForm payerId={s.payer.id} balance={s.balance} />
          </section>
        )}

        <section className="surface p-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-semibold">Invoices in the period</h2>
            <Form action={`/billing/payers/${s.payer.id}`} className="flex flex-wrap items-center gap-2 text-sm print:hidden">
              <input type="date" name="from" defaultValue={s.from} aria-label="From" className={`${inputClass} w-40`} />
              <span className="text-slate-500">to</span>
              <input type="date" name="to" defaultValue={s.to} aria-label="To" className={`${inputClass} w-40`} />
              <button className={secondaryButtonClass}>Show</button>
            </Form>
          </div>
          {s.invoices.length ? <InvoiceTable rows={s.invoices} /> : <p className="text-sm text-slate-500">No invoices in this period.</p>}
        </section>

        {s.unpaid.length > 0 && (
          <section className="surface p-5">
            <h2 className="mb-3 font-semibold">All unpaid invoices</h2>
            <InvoiceTable rows={s.unpaid} />
          </section>
        )}
      </div>
    </>
  );
}

export default function PayerPage({ params, searchParams }: PageProps<"/billing/payers/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Statement params={params} searchParams={searchParams as Promise<{ from?: string; to?: string }>} />
    </Suspense>
  );
}

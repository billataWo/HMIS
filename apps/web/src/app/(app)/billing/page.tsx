import { Receipt } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { InvoiceBadge } from "@/components/invoice-badge";
import { EmptyState, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Invoice, type Me, type Payer, type PendingBill } from "@/lib/api";
import { etb, formatDualDate, formatTime, fullName } from "@/lib/format";
import { InvoiceForm } from "./billing-forms";

async function Billing() {
  let me: Me, pending: PendingBill[], invoices: Invoice[], payers: Payer[];
  try {
    [me, pending, invoices, payers] = await Promise.all([api<Me>("/auth/me"), api<PendingBill[]>("/billing/pending"), api<Invoice[]>("/invoices"), api<Payer[]>("/payers")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only cashiers and admins can use billing.</p>;
    throw e;
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-medium">
          To bill <span className="text-slate-500">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <EmptyState icon={Receipt} title="Nothing waiting to be billed" />
        ) : (
          <div className="space-y-4">
            {pending.map((v) => (
              <div key={v.id} className="space-y-3 surface p-4 dark:border-slate-800">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link href={`/patients/${v.patient.id}`} className="font-medium hover:underline">
                      {fullName(v.patient)}
                    </Link>
                    <span className="text-sm text-slate-500">
                      {" "}· {v.patient.mrn} · queue #{v.queueNumber}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDualDate(v.checkedInAt)} · {formatTime(v.checkedInAt)}
                    {v.doctor && ` · Dr. ${v.doctor.fullName}`}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {v.charges.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1.5">{c.description}</td>
                        <td className="py-1.5 text-right text-slate-500 tabular-nums">
                          {c.quantity > 1 && `${c.quantity} × ${Number(c.unitPrice).toFixed(2)}`}
                        </td>
                        <td className="w-32 py-1.5 text-right tabular-nums">{etb(Number(c.unitPrice) * c.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <InvoiceForm visitId={v.id} subtotal={v.subtotal} canDiscount={me.role === "ADMIN"} payers={payers.filter((p) => p.active)} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-medium">
          Invoices today <span className="text-slate-500">({invoices.length})</span>
        </h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">No invoices yet today.</p>
        ) : (
          <div className="overflow-x-auto surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Payer</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/billing/invoices/${i.id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                        {i.number}
                      </Link>
                      <span className="block text-slate-500">{formatTime(i.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3">{fullName(i.patient)}</td>
                    <td className="px-4 py-3">{i.payerType === "SELF" ? "Patient" : i.payerName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{etb(i.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{i.status === "VOID" ? "—" : etb(i.balance)}</td>
                    <td className="px-4 py-3">
                      <InvoiceBadge status={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function BillingPage() {
  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="ክፍያ · cashier"
        actions={
          <Link href="/billing/daily" className={secondaryButtonClass}>
            Day summary &amp; cash closing
          </Link>
        }
      />
      <AutoRefresh seconds={20} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Billing />
      </Suspense>
    </>
  );
}

import { Receipt } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PageTitle } from "@/components/page-title";
import { EmptyState, secondaryButtonClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type Invoice, type Me, type Payer, type PendingBill } from "@/lib/api";
import { etb, formatDualDate, formatTime, fullName } from "@/lib/format";
import { InvoiceForm, VisitPayerForm } from "./billing-forms";
import { NoAccess } from "@/components/status-page";

async function Billing() {
  let me: Me, pending: PendingBill[], invoices: Invoice[], payers: Payer[];
  const t = await getT();
  try {
    [me, pending, invoices, payers] = await Promise.all([api<Me>("/auth/me"), api<PendingBill[]>("/billing/pending"), api<Invoice[]>("/invoices"), api<Payer[]>("/payers")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only cashiers and admins can use billing.")}</NoAccess>;
    throw e;
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-medium">
          {t("To bill")} <span className="text-slate-500">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <EmptyState icon={Receipt} title={t("Nothing waiting to be billed")} />
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
                      {" "}· {v.patient.mrn} · {t("queue #{n}", { n: v.queueNumber })}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDualDate(v.checkedInAt)} · {formatTime(v.checkedInAt)}
                    {v.doctor && ` · ${t("Dr. {name}", { name: v.doctor.fullName })}`}
                  </span>
                </div>
                {v.payer && (
                  <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                    {t.rich("Billed to {payer}: covers {covered}. The patient pays {part} (their co-payment and anything not covered).", {
                      payer: <span className="font-medium">{v.payer.name}</span>,
                      covered: etb(v.covered ?? "0", t),
                      part: <span className="font-medium">{etb(v.patientPart ?? "0", t)}</span>,
                    })}
                  </p>
                )}
                <table className="w-full text-sm">
                  <tbody>
                    {v.charges.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1.5">
                          {c.description}
                          {v.payer && <span className="ml-2 text-xs text-slate-500">{c.payerId ? v.payer.name : t("patient (not covered)")}</span>}
                        </td>
                        <td className="py-1.5 text-right text-slate-500 tabular-nums">
                          {c.quantity > 1 && `${c.quantity} × ${Number(c.unitPrice).toFixed(2)}`}
                        </td>
                        <td className="w-32 py-1.5 text-right tabular-nums">{etb(Number(c.unitPrice) * c.quantity, t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {v.patient.coverages && v.patient.coverages.length > 0 && <VisitPayerForm visitId={v.id} coverages={v.patient.coverages} />}
                <InvoiceForm
                  visitId={v.id}
                  subtotal={v.subtotal}
                  canDiscount={me.role === "ADMIN"}
                  payers={payers.filter((p) => p.active)}
                  sponsor={v.payer ? { name: v.payer.name, allCovered: v.charges.every((c) => c.payerId) } : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-medium">
          {t("Invoices today")} <span className="text-slate-500">({invoices.length})</span>
        </h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">{t("No invoices yet today.")}</p>
        ) : (
          <div className="overflow-x-auto surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("Invoice")}</th>
                  <th className="px-4 py-3 font-medium">{t("Patient")}</th>
                  <th className="px-4 py-3 font-medium">{t("Payer")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("Total")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("Balance")}</th>
                  <th className="px-4 py-3 font-medium">{t("Status")}</th>
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
                    <td className="px-4 py-3">{i.payerType === "SELF" ? t("Patient") : i.payerName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{etb(i.total, t)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {i.status === "VOID" ? "—" : etb(i.balance, t)}
                      {i.payerType !== "SELF" && Number(i.patientDue ?? 0) > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">{t("patient owes {amount}", { amount: etb(i.patientDue!, t) })}</span>}
                    </td>
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

async function DailyLink() {
  const t = await getT();
  return (
    <Link href="/billing/daily" className={secondaryButtonClass}>
      {t("Day summary & cash closing")}
    </Link>
  );
}

export default function BillingPage() {
  return (
    <>
      <PageTitle title="Billing" subtitle="cashier" actions={<DailyLink />} />
      <AutoRefresh seconds={20} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Billing />
      </Suspense>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type InvoiceDetail, type Me } from "@/lib/api";
import { DISCOUNT_CATEGORIES, etb, formatDualDate, formatTime, fullName, PAYMENT_METHODS } from "@/lib/format";
import { getT } from "@/lib/lang";
import { PaymentForm, RemoveLineForm, ReversePaymentForm, VoidForm } from "../../billing-forms";
import { NoAccess } from "@/components/status-page";

async function InvoiceView({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t] = await Promise.all([params, getT()]);
  let inv: InvoiceDetail, me: Me;
  try {
    [inv, me] = await Promise.all([api<InvoiceDetail>(`/invoices/${id}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only cashiers and admins can view invoices.")}</NoAccess>;
    throw e;
  }
  // On a payer's invoice the counter takes only the patient's co-payment; the payer settles the rest.
  const sponsored = inv.payerType !== "SELF";
  const dueHere = sponsored ? (inv.patientDue ?? "0") : inv.balance;
  const open = inv.status !== "VOID" && Number(dueHere) > 0;
  const canRemove = me.role === "ADMIN" && inv.status !== "VOID";

  return (
    <>
      <PageHeader
        title={inv.number}
        subtitle={`${fullName(inv.patient)} · ${inv.patient.mrn} · ${formatDualDate(inv.createdAt)} ${formatTime(inv.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceBadge status={inv.status} />
            {inv.status !== "VOID" && (
              <Link href={`/receipt/${inv.id}`} target="_blank" className={secondaryButtonClass}>
                {t("Print receipt")}
              </Link>
            )}
            <Link href="/billing" className={secondaryButtonClass}>
              {t("Billing")}
            </Link>
          </div>
        }
      />

      {inv.status === "VOID" && (
        <div className="mb-4 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          {t("Voided {date}: {reason}. Any lines not removed went back to “To bill”.", { date: inv.voidedAt ? formatDualDate(inv.voidedAt) : "", reason: inv.voidReason ?? "" })}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="surface p-4 dark:border-slate-800">
            <p className="mb-2 text-sm text-slate-500">
              {t("Payer")}: {inv.payerType === "SELF" ? t("Patient") : `${t(inv.payerType === "CREDIT" ? "Credit" : "Insurance")} · ${inv.payerName}`} · {t("created by {name}", { name: inv.createdBy.fullName })}
              {inv.visit?.memberId && ` · ${t("member {id}", { id: inv.visit.memberId })}`}
              {inv.visit?.authorizationNo && ` · ${t("authorization {no}", { no: inv.visit.authorizationNo })}`}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {inv.charges.map((c) => (
                  <tr key={c.id} className={`border-t border-slate-100 align-top dark:border-slate-800 ${c.voidedAt ? "text-slate-500" : ""}`}>
                    <td className="py-1.5">
                      {c.voidedAt ? <s>{c.description}</s> : c.description}
                      {c.voidedAt && <span className="block text-xs">{t("Removed and refunded: {reason}", { reason: c.voidReason ?? "" })}</span>}
                      {canRemove && !c.voidedAt && (
                        <RemoveLineForm invoiceId={inv.id} chargeId={c.id} isDrug={c.source === "PHARMACY"} quantity={c.quantity} refundDue={Number(inv.paid) > 0} />
                      )}
                    </td>
                    <td className="py-1.5 text-right text-slate-500 tabular-nums">{c.quantity > 1 && `${c.quantity} × ${Number(c.unitPrice).toFixed(2)}`}</td>
                    <td className="w-32 py-1.5 text-right tabular-nums">{c.voidedAt ? <s>{etb(Number(c.unitPrice) * c.quantity, t)}</s> : etb(Number(c.unitPrice) * c.quantity, t)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-right tabular-nums">
                {Number(inv.discount) > 0 && (
                  <>
                    <tr className="border-t border-slate-200 dark:border-slate-700">
                      <td colSpan={2} className="py-1.5 text-slate-500">{t("Subtotal")}</td>
                      <td className="py-1.5">{etb(inv.subtotal, t)}</td>
                    </tr>
                    <tr>
                      <td colSpan={2} className="py-1.5 text-slate-500">
                        {t(inv.discountCategory ? DISCOUNT_CATEGORIES[inv.discountCategory] : "Discount")}
                        {inv.discountReason && ` · ${inv.discountReason}`}
                      </td>
                      <td className="py-1.5">−{etb(inv.discount, t)}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
                  <td colSpan={2} className="py-1.5">{t("Total")}</td>
                  <td className="py-1.5">{etb(inv.total, t)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="py-1.5 text-slate-500">{t("Paid")}</td>
                  <td className="py-1.5">{etb(inv.paid, t)}</td>
                </tr>
                {!sponsored && (
                  <tr className="font-semibold">
                    <td colSpan={2} className="py-1.5">{t("Balance")}</td>
                    <td className="py-1.5">{inv.status === "VOID" ? "—" : etb(inv.balance, t)}</td>
                  </tr>
                )}
                {sponsored && inv.status !== "VOID" && (
                  <>
                    <tr className="border-t border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      <td colSpan={2} className="py-1.5">
                        {t("Patient's co-payment")}{inv.visit?.coPayPercent ? ` (${Number(inv.visit.coPayPercent)}%)` : ""}
                      </td>
                      <td className="py-1.5">
                        {etb(inv.patientShare ?? "0", t)}
                        {Number(inv.patientDue ?? 0) > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">{t("{amount} still to pay", { amount: etb(inv.patientDue!, t) })}</span>}
                      </td>
                    </tr>
                    <tr className="text-slate-600 dark:text-slate-300">
                      <td colSpan={2} className="py-1.5">{t("{payer} owes", { payer: inv.payerName ?? "" })}</td>
                      <td className="py-1.5">{etb(inv.payerDue ?? "0", t)}</td>
                    </tr>
                  </>
                )}
              </tfoot>
            </table>
          </section>

          {sponsored && inv.status !== "VOID" && !open && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              {t("The patient's co-payment is paid.")}{" "}
              {t(Number(inv.payerDue ?? 0) > 0 ? "{payer} settles the rest from its account." : "{payer} has paid its share.", { payer: inv.payerName ?? "" })}
            </p>
          )}
          {open && (
            <section className="surface p-4 dark:border-slate-800">
              <h2 className="mb-3 font-medium">{t(sponsored ? "Take the patient's co-payment" : "Take payment")}</h2>
              <PaymentForm invoiceId={inv.id} balance={dueHere} />
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section>
            <h2 className="mb-2 font-medium">{t("Payments")}</h2>
            {inv.payments.length === 0 ? (
              <p className="text-sm text-slate-500">{t("None yet.")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {inv.payments.map((p) => (
                  <li key={p.id} className={`rounded-md px-3 py-2 ${Number(p.amount) < 0 ? "bg-red-50 dark:bg-red-950/40" : "bg-slate-50 dark:bg-slate-900"}`}>
                    {Number(p.amount) < 0 ? (
                      <span className="font-medium text-red-800 dark:text-red-200">
                        {t(p.reversalOfId ? "Reversal" : "Refund")} {etb(-Number(p.amount), t)}
                      </span>
                    ) : (
                      <span className="font-medium">{etb(p.amount, t)}</span>
                    )}{" "}
                    · {t(PAYMENT_METHODS[p.method])}
                    {p.note && <span className="block text-xs text-slate-600 dark:text-slate-400">{p.note}</span>}
                    {p.reference && <span className="block font-mono text-xs text-slate-500">{p.reference}</span>}
                    <span className="block text-xs text-slate-500">
                      {formatTime(p.receivedAt)} · {p.cashier.fullName}
                    </span>
                    {me.role === "ADMIN" && Number(p.amount) > 0 && !p.reversalOfId && !inv.payments.some((x) => x.reversalOfId === p.id) && <ReversePaymentForm paymentId={p.id} />}
                    {inv.payments.some((x) => x.reversalOfId === p.id) && <span className="block text-xs font-medium text-red-700 dark:text-red-400">{t("Reversed")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {me.role === "ADMIN" && inv.status !== "VOID" && Number(inv.paid) === 0 && <VoidForm invoiceId={inv.id} />}
        </aside>
      </div>
    </>
  );
}

export default function InvoicePage({ params }: PageProps<"/billing/invoices/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <InvoiceView params={params} />
    </Suspense>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type InvoiceDetail, type Me } from "@/lib/api";
import { DISCOUNT_CATEGORIES, etb, formatDualDate, formatTime, fullName, PAYMENT_METHODS } from "@/lib/format";
import { PaymentForm, RemoveLineForm, ReversePaymentForm, VoidForm } from "../../billing-forms";

async function InvoiceView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let inv: InvoiceDetail, me: Me;
  try {
    [inv, me] = await Promise.all([api<InvoiceDetail>(`/invoices/${id}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only cashiers and admins can view invoices.</p>;
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
                Print receipt
              </Link>
            )}
            <Link href="/billing" className={secondaryButtonClass}>
              Billing
            </Link>
          </div>
        }
      />

      {inv.status === "VOID" && (
        <div className="mb-4 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          Voided {inv.voidedAt && formatDualDate(inv.voidedAt)}: {inv.voidReason}. Any lines not removed went back to “To bill”.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="surface p-4 dark:border-slate-800">
            <p className="mb-2 text-sm text-slate-500">
              Payer: {inv.payerType === "SELF" ? "Patient" : `${inv.payerType === "CREDIT" ? "Credit" : "Insurance"} · ${inv.payerName}`} · created by {inv.createdBy.fullName}
              {inv.visit?.memberId && ` · member ${inv.visit.memberId}`}
              {inv.visit?.authorizationNo && ` · authorization ${inv.visit.authorizationNo}`}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {inv.charges.map((c) => (
                  <tr key={c.id} className={`border-t border-slate-100 align-top dark:border-slate-800 ${c.voidedAt ? "text-slate-500" : ""}`}>
                    <td className="py-1.5">
                      {c.voidedAt ? <s>{c.description}</s> : c.description}
                      {c.voidedAt && <span className="block text-xs">Removed and refunded: {c.voidReason}</span>}
                      {canRemove && !c.voidedAt && (
                        <RemoveLineForm invoiceId={inv.id} chargeId={c.id} isDrug={c.source === "PHARMACY"} quantity={c.quantity} refundDue={Number(inv.paid) > 0} />
                      )}
                    </td>
                    <td className="py-1.5 text-right text-slate-500 tabular-nums">{c.quantity > 1 && `${c.quantity} × ${Number(c.unitPrice).toFixed(2)}`}</td>
                    <td className="w-32 py-1.5 text-right tabular-nums">{c.voidedAt ? <s>{etb(Number(c.unitPrice) * c.quantity)}</s> : etb(Number(c.unitPrice) * c.quantity)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-right tabular-nums">
                {Number(inv.discount) > 0 && (
                  <>
                    <tr className="border-t border-slate-200 dark:border-slate-700">
                      <td colSpan={2} className="py-1.5 text-slate-500">Subtotal</td>
                      <td className="py-1.5">{etb(inv.subtotal)}</td>
                    </tr>
                    <tr>
                      <td colSpan={2} className="py-1.5 text-slate-500">
                        {inv.discountCategory ? DISCOUNT_CATEGORIES[inv.discountCategory] : "Discount"}
                        {inv.discountReason && ` · ${inv.discountReason}`}
                      </td>
                      <td className="py-1.5">−{etb(inv.discount)}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
                  <td colSpan={2} className="py-1.5">Total</td>
                  <td className="py-1.5">{etb(inv.total)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="py-1.5 text-slate-500">Paid</td>
                  <td className="py-1.5">{etb(inv.paid)}</td>
                </tr>
                {!sponsored && (
                  <tr className="font-semibold">
                    <td colSpan={2} className="py-1.5">Balance</td>
                    <td className="py-1.5">{inv.status === "VOID" ? "—" : etb(inv.balance)}</td>
                  </tr>
                )}
                {sponsored && inv.status !== "VOID" && (
                  <>
                    <tr className="border-t border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      <td colSpan={2} className="py-1.5">
                        Patient&apos;s co-payment{inv.visit?.coPayPercent ? ` (${Number(inv.visit.coPayPercent)}%)` : ""}
                      </td>
                      <td className="py-1.5">
                        {etb(inv.patientShare ?? "0")}
                        {Number(inv.patientDue ?? 0) > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">{etb(inv.patientDue!)} still to pay</span>}
                      </td>
                    </tr>
                    <tr className="text-slate-600 dark:text-slate-300">
                      <td colSpan={2} className="py-1.5">{inv.payerName} owes</td>
                      <td className="py-1.5">{etb(inv.payerDue ?? "0")}</td>
                    </tr>
                  </>
                )}
              </tfoot>
            </table>
          </section>

          {sponsored && inv.status !== "VOID" && !open && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              The patient&apos;s co-payment is paid. {Number(inv.payerDue ?? 0) > 0 ? `${inv.payerName} settles the rest from its account.` : `${inv.payerName} has paid its share.`}
            </p>
          )}
          {open && (
            <section className="surface p-4 dark:border-slate-800">
              <h2 className="mb-3 font-medium">{sponsored ? "Take the patient's co-payment" : "Take payment"}</h2>
              <PaymentForm invoiceId={inv.id} balance={dueHere} />
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section>
            <h2 className="mb-2 font-medium">Payments</h2>
            {inv.payments.length === 0 ? (
              <p className="text-sm text-slate-500">None yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {inv.payments.map((p) => (
                  <li key={p.id} className={`rounded-md px-3 py-2 ${Number(p.amount) < 0 ? "bg-red-50 dark:bg-red-950/40" : "bg-slate-50 dark:bg-slate-900"}`}>
                    {Number(p.amount) < 0 ? (
                      <span className="font-medium text-red-800 dark:text-red-200">
                        {p.reversalOfId ? "Reversal" : "Refund"} {etb(-Number(p.amount))}
                      </span>
                    ) : (
                      <span className="font-medium">{etb(p.amount)}</span>
                    )}{" "}
                    · {PAYMENT_METHODS[p.method]}
                    {p.note && <span className="block text-xs text-slate-600 dark:text-slate-400">{p.note}</span>}
                    {p.reference && <span className="block font-mono text-xs text-slate-500">{p.reference}</span>}
                    <span className="block text-xs text-slate-500">
                      {formatTime(p.receivedAt)} · {p.cashier.fullName}
                    </span>
                    {me.role === "ADMIN" && Number(p.amount) > 0 && !p.reversalOfId && !inv.payments.some((x) => x.reversalOfId === p.id) && <ReversePaymentForm paymentId={p.id} />}
                    {inv.payments.some((x) => x.reversalOfId === p.id) && <span className="block text-xs font-medium text-red-700 dark:text-red-400">Reversed</span>}
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

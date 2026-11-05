import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InvoiceBadge } from "@/components/invoice-badge";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type InvoiceDetail, type Me } from "@/lib/api";
import { etb, formatDualDate, formatTime, fullName, PAYMENT_METHODS } from "@/lib/format";
import { PaymentForm, VoidForm } from "../../billing-forms";

async function InvoiceView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let inv: InvoiceDetail, me: Me;
  try {
    [inv, me] = await Promise.all([api<InvoiceDetail>(`/invoices/${id}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-zinc-500">Only cashiers and admins can view invoices.</p>;
    throw e;
  }
  const open = inv.status !== "VOID" && Number(inv.balance) > 0;

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
                Print receipt ↗
              </Link>
            )}
            <Link href="/billing" className={secondaryButtonClass}>
              Billing
            </Link>
          </div>
        }
      />

      {inv.status === "VOID" && (
        <div className="mb-4 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          Voided {inv.voidedAt && formatDualDate(inv.voidedAt)}: {inv.voidReason}. Its charges went back to “To bill”.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 text-sm text-zinc-500">
              Payer: {inv.payerType === "SELF" ? "Patient" : `${inv.payerType === "CREDIT" ? "Credit" : "Insurance"} · ${inv.payerName}`} · created by {inv.createdBy.fullName}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {inv.charges.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5">{c.description}</td>
                    <td className="py-1.5 text-right text-zinc-500 tabular-nums">{c.quantity > 1 && `${c.quantity} × ${Number(c.unitPrice).toFixed(2)}`}</td>
                    <td className="w-32 py-1.5 text-right tabular-nums">{etb(Number(c.unitPrice) * c.quantity)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-right tabular-nums">
                {Number(inv.discount) > 0 && (
                  <>
                    <tr className="border-t border-zinc-200 dark:border-zinc-700">
                      <td colSpan={2} className="py-1.5 text-zinc-500">Subtotal</td>
                      <td className="py-1.5">{etb(inv.subtotal)}</td>
                    </tr>
                    <tr>
                      <td colSpan={2} className="py-1.5 text-zinc-500">Discount ({inv.discountReason})</td>
                      <td className="py-1.5">−{etb(inv.discount)}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-700">
                  <td colSpan={2} className="py-1.5">Total</td>
                  <td className="py-1.5">{etb(inv.total)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="py-1.5 text-zinc-500">Paid</td>
                  <td className="py-1.5">{etb(inv.paid)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={2} className="py-1.5">Balance</td>
                  <td className="py-1.5">{inv.status === "VOID" ? "—" : etb(inv.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {open && (
            <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="mb-3 font-medium">Take payment</h2>
              <PaymentForm invoiceId={inv.id} balance={inv.balance} />
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section>
            <h2 className="mb-2 font-medium">Payments</h2>
            {inv.payments.length === 0 ? (
              <p className="text-sm text-zinc-500">None yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {inv.payments.map((p) => (
                  <li key={p.id} className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                    <span className="font-medium">{etb(p.amount)}</span> · {PAYMENT_METHODS[p.method]}
                    {p.reference && <span className="block font-mono text-xs text-zinc-500">{p.reference}</span>}
                    <span className="block text-xs text-zinc-500">
                      {formatTime(p.receivedAt)} · {p.cashier.fullName}
                    </span>
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

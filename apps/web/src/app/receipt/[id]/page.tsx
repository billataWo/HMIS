import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { api, ApiError, type InvoiceDetail } from "@/lib/api";
import { etb, formatDualDate, formatTime, fullName, PAYMENT_METHODS } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Receipt" };

// Sized for 80 mm thermal receipt printers; also prints fine on A4.
async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let inv: InvoiceDetail;
  try {
    inv = await api<InvoiceDetail>(`/invoices/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }

  return (
    <div className="mx-auto w-full max-w-[80mm] space-y-3 font-mono text-[12px] leading-snug text-black">
      <header className="text-center">
        <p className="text-sm font-bold">{inv.tenant.name}</p>
        {inv.tenant.nameAm && <p>{inv.tenant.nameAm}</p>}
        {inv.tenant.address && <p>{inv.tenant.address}</p>}
        {inv.tenant.phone && <p>Tel {inv.tenant.phone}</p>}
      </header>
      <div className="border-y border-dashed border-black py-2">
        <p>
          {inv.status === "PAID" ? "RECEIPT" : "INVOICE"} {inv.number}
        </p>
        <p>
          {formatDualDate(inv.createdAt)} {formatTime(inv.createdAt)}
        </p>
        <p>
          {fullName(inv.patient)} · {inv.patient.mrn}
        </p>
        {inv.payerType !== "SELF" && (
          <p>
            Payer: {inv.payerName}
            {inv.visit?.memberId && ` · ${inv.visit.memberId}`}
          </p>
        )}
      </div>
      <table className="w-full">
        <tbody>
          {inv.charges.map((c) => (
            <tr key={c.id} className="align-top">
              <td className="pr-2">
                {c.voidedAt ? <s>{c.description}</s> : c.description}
                {c.quantity > 1 && ` ×${c.quantity}`}
                {c.voidedAt && " (refunded)"}
              </td>
              <td className="text-right whitespace-nowrap">{c.voidedAt ? <s>{(Number(c.unitPrice) * c.quantity).toFixed(2)}</s> : (Number(c.unitPrice) * c.quantity).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-0.5 border-t border-dashed border-black pt-2">
        {Number(inv.discount) > 0 && (
          <>
            <p className="flex justify-between">
              <span>Subtotal</span>
              <span>{Number(inv.subtotal).toFixed(2)}</span>
            </p>
            <p className="flex justify-between">
              <span>Discount</span>
              <span>-{Number(inv.discount).toFixed(2)}</span>
            </p>
          </>
        )}
        <p className="flex justify-between font-bold">
          <span>TOTAL</span>
          <span>{etb(inv.total)}</span>
        </p>
        {inv.payerType !== "SELF" && (
          <>
            <p className="flex justify-between">
              <span>Covered by {inv.payerName}</span>
              <span>{(Number(inv.total) - Number(inv.patientShare ?? 0)).toFixed(2)}</span>
            </p>
            <p className="flex justify-between font-bold">
              <span>YOUR CO-PAYMENT</span>
              <span>{etb(inv.patientShare ?? "0")}</span>
            </p>
          </>
        )}
        {inv.payments.filter((p) => !p.byPayer).map((p) => (
          <p key={p.id} className="flex justify-between">
            <span>
              {Number(p.amount) < 0 ? "Refund · " : ""}
              {PAYMENT_METHODS[p.method]}
              {p.reference && ` ${p.reference}`}
            </span>
            <span>{Number(p.amount).toFixed(2)}</span>
          </p>
        ))}
        {Number(inv.payerType === "SELF" ? inv.balance : (inv.patientDue ?? 0)) > 0 && (
          <p className="flex justify-between font-bold">
            <span>BALANCE DUE</span>
            <span>{etb(inv.payerType === "SELF" ? inv.balance : inv.patientDue!)}</span>
          </p>
        )}
      </div>
      <footer className="border-t border-dashed border-black pt-2 text-center">
        <p>Cashier: {inv.payments.at(-1)?.cashier.fullName ?? inv.createdBy.fullName}</p>
        <p>Thank you · እናመሰግናለን</p>
      </footer>
      <PrintButton />
    </div>
  );
}

export default function ReceiptPage({ params }: PageProps<"/receipt/[id]">) {
  return (
    <main className="flex-1 bg-white px-4 py-6">
      <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
        <Receipt params={params} />
      </Suspense>
    </main>
  );
}

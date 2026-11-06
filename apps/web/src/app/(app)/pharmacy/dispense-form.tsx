"use client";

import { useActionState, useState } from "react";
import { closePrescription, dispensePrescription, type FormState } from "@/app/actions";
import { Alert, buttonClass, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { PrescriptionItem } from "@/lib/api";

/**
 * Bill-at-the-end clinics: one "Dispense" step (charges are created as drugs are handed over).
 * Pay-first clinics: "Send to cashier" prices what the patient will take; once paid, "Dispense".
 */
export function DispenseForm({ prescriptionId, items, prepayment }: { prescriptionId: string; items: PrescriptionItem[]; prepayment: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(dispensePrescription, {});
  const rows = items.map((i) => {
    const stock = i.inStock ?? 0;
    const paid = i.paidQty ?? 0;
    const toBill = Math.max(0, Math.min(i.quantity - i.billedQty, stock - (i.billedQty - i.dispensedQty)));
    const toGive = prepayment ? Math.max(0, Math.min(paid - i.dispensedQty, stock)) : Math.max(0, Math.min(i.quantity - i.dispensedQty, stock));
    return { i, stock, paid, toBill, toGive };
  });
  const priced = (i: PrescriptionItem) => Number(i.drug.sellPrice) > 0;
  const canBill = prepayment && items.some((i) => priced(i) && i.billedQty < i.quantity);
  const canGive = rows.some((r) => r.toGive > 0);
  const awaitingPayment = prepayment && items.some((i) => i.billedQty > (i.paidQty ?? 0));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="prescriptionId" value={prescriptionId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && state.values?.step === "bill" && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">Sent to the cashier. Dispense once the patient has paid.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Drug</th>
              <th className="py-1 pr-3 font-medium">Directions</th>
              <th className="py-1 pr-3 text-right font-medium">Prescribed</th>
              {prepayment && <th className="py-1 pr-3 text-right font-medium">To cashier / paid</th>}
              <th className="py-1 pr-3 text-right font-medium">Given</th>
              <th className="py-1 pr-3 text-right font-medium">In stock</th>
              {canBill && <th className="py-1 pr-3 font-medium">Send to cashier</th>}
              <th className="py-1 font-medium">Give now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ i, stock, paid, toBill, toGive }) => (
              <tr key={i.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 pr-3">
                  <span className="font-medium">{i.drug.genericName}</span> {i.drug.strength} {i.drug.form}
                  <span className="block text-xs text-slate-500">
                    {Number(i.drug.sellPrice).toFixed(2)} ETB / {i.drug.unit}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {i.dose} {i.frequency}
                  {i.durationDays && ` × ${i.durationDays} d`}
                  {i.instructions && <span className="block text-xs text-slate-500">{i.instructions}</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{i.quantity}</td>
                {prepayment && (
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {i.billedQty} / <span className={paid < i.billedQty ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{paid}</span>
                  </td>
                )}
                <td className="py-2 pr-3 text-right tabular-nums">{i.dispensedQty}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${stock < i.quantity - i.dispensedQty ? "font-medium text-red-700 dark:text-red-400" : ""}`}>{stock}</td>
                {canBill && (
                  <td className="py-2 pr-3">
                    {!priced(i) ? (
                      <span className="text-xs text-slate-500">free</span>
                    ) : i.billedQty < i.quantity ? (
                      <input
                        name={`bill_${i.id}`}
                        type="number"
                        min={0}
                        max={i.quantity - i.billedQty}
                        defaultValue={toBill}
                        aria-label={`Units of ${i.drug.genericName} to send to the cashier`}
                        className={`${inputClass} w-20`}
                      />
                    ) : (
                      <span className="text-xs text-slate-500">sent</span>
                    )}
                  </td>
                )}
                <td className="py-2">
                  {i.dispensedQty < i.quantity ? (
                    <input
                      name={`dispense_${i.id}`}
                      type="number"
                      min={0}
                      max={i.quantity - i.dispensedQty}
                      defaultValue={toGive}
                      aria-label={`Units of ${i.drug.genericName} to give`}
                      className={`${inputClass} w-20`}
                    />
                  ) : (
                    <span className="text-xs text-slate-500">done</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {awaitingPayment && <p className="text-sm text-amber-700 dark:text-amber-400">Waiting for the patient to pay at the cashier.</p>}
      <div className="flex flex-wrap gap-2">
        {canBill && (
          <button type="submit" name="step" value="bill" disabled={pending} className={canGive ? secondaryButtonClass : buttonClass}>
            {pending ? "Saving…" : "Send to cashier"}
          </button>
        )}
        <button type="submit" name="step" value="dispense" disabled={pending || (prepayment && !canGive)} className={canGive || !prepayment ? buttonClass : secondaryButtonClass}>
          {pending ? "Saving…" : prepayment ? "Dispense paid" : "Dispense"}
        </button>
      </div>
    </form>
  );
}

/**
 * When the patient won't collect the rest (bought it elsewhere, left): closes the prescription and
 * drops unpaid drug charges. Paid but undelivered drugs must be refunded by an admin first.
 */
export function ClosePrescriptionForm({ prescriptionId }: { prescriptionId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(closePrescription, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
        Patient won&apos;t collect the rest? Close it
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <input type="hidden" name="prescriptionId" value={prescriptionId} />
      {state.error && <Alert>{state.error}</Alert>}
      <Input name="reason" required minLength={3} placeholder="Why? e.g. bought outside, out of stock, patient left" aria-label="Reason" defaultValue={state.values?.reason} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
          {pending ? "Closing…" : "Close prescription"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
          Keep it open
        </button>
      </div>
    </form>
  );
}

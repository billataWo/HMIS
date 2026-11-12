"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { returnDrugs, type ReturnState } from "@/app/actions";
import { Alert, buttonClass, Input, inputClass, Notice, secondaryButtonClass } from "@/components/ui";

/**
 * Drugs a patient brought back: how many, whether they can be sold again (sealed, in date) or are
 * kept aside for destruction, and why. Paid units still on an invoice are refunded there by an admin.
 */
export function ReturnForm({
  itemId,
  drug,
  unit,
  withPatient,
  canOpenInvoices,
  label = "Record a return",
}: {
  itemId: string;
  drug: string;
  unit: string;
  withPatient: number;
  canOpenInvoices: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState<ReturnState, FormData>(returnDrugs, {});
  const [open, setOpen] = useState(false);
  const r = state.ok && !pending ? state.result : undefined;

  if (r) {
    return (
      <Notice tone={r.refundDue ? "warning" : "success"} className="mt-2 text-xs">
        <p>
          {r.quantity} {unit} of {drug} returned{r.restocked ? " and put back on the shelf" : ", kept aside for destruction"}.
        </p>
        {r.refundDue > 0 && (
          <p className="mt-1">
            {r.refundDue} {unit} {r.refundDue === 1 ? "is" : "are"} still charged on{" "}
            {r.invoices.map((inv, i) => (
              <span key={inv.id}>
                {i > 0 && ", "}
                {canOpenInvoices ? (
                  <Link href={`/billing/invoices/${inv.id}`} className="font-medium underline">
                    {inv.number}
                  </Link>
                ) : (
                  <strong>{inv.number}</strong>
                )}
              </span>
            ))}
            : an admin refunds {r.refundDue === 1 ? "it" : "them"} there (Remove line).
          </p>
        )}
      </Notice>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
        {label}
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40">
      <input type="hidden" name="itemId" value={itemId} />
      <p className="font-medium">
        Return of {drug} <span className="font-normal text-slate-500">· {withPatient} {unit} with the patient</span>
      </p>
      {state.error && <Alert>{state.error}</Alert>}
      <label className="flex items-center gap-2">
        <span className="w-20 text-slate-600 dark:text-slate-300">Units</span>
        <input
          name="quantity"
          type="number"
          min={1}
          max={withPatient}
          required
          defaultValue={state.values?.quantity ?? withPatient}
          aria-label={`Units of ${drug} returned`}
          className={`${inputClass} w-24`}
        />
        <span className="text-xs text-slate-500">{unit}</span>
      </label>
      <fieldset className="space-y-1">
        <legend className="sr-only">Condition</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="condition" value="restock" required defaultChecked={state.values?.condition === "restock"} className="mt-1" />
          <span>Sealed and in date: put back on the shelf</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="condition" value="discard" required defaultChecked={state.values?.condition === "discard"} className="mt-1" />
          <span>Opened, damaged or doubtful: keep aside for destruction</span>
        </label>
      </fieldset>
      <Input name="reason" required minLength={3} maxLength={300} placeholder="Why? e.g. side effects, treatment changed" aria-label="Reason for the return" defaultValue={state.values?.reason} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
          {pending ? "Saving…" : "Record return"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { returnDrugs, type ReturnState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
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
  const t = useT();

  if (r) {
    return (
      <Notice tone={r.refundDue ? "warning" : "success"} className="mt-2 text-xs">
        <p>
          {t(r.restocked ? "{n} {unit} of {drug} returned and put back on the shelf." : "{n} {unit} of {drug} returned, kept aside for destruction.", { n: r.quantity, unit, drug })}
        </p>
        {r.refundDue > 0 && (
          <p className="mt-1">
            {t.rich("{n} {unit} still charged on {invoices}: an admin refunds them there (Remove line).", {
              n: r.refundDue,
              unit,
              invoices: r.invoices.map((inv, i) => (
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
              )),
            })}
          </p>
        )}
      </Notice>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
        {t(label)}
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40">
      <input type="hidden" name="itemId" value={itemId} />
      <p className="font-medium">
        {t("Return of {drug}", { drug })} <span className="font-normal text-slate-500">· {t("{n} {unit} with the patient", { n: withPatient, unit })}</span>
      </p>
      {state.error && <Alert>{t(state.error)}</Alert>}
      <label className="flex items-center gap-2">
        <span className="w-20 text-slate-600 dark:text-slate-300">{t("Units")}</span>
        <input
          name="quantity"
          type="number"
          min={1}
          max={withPatient}
          required
          defaultValue={state.values?.quantity ?? withPatient}
          aria-label={t("Units of {drug} returned", { drug })}
          className={`${inputClass} w-24`}
        />
        <span className="text-xs text-slate-500">{unit}</span>
      </label>
      <fieldset className="space-y-1">
        <legend className="sr-only">{t("Condition of the drugs")}</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="condition" value="restock" required defaultChecked={state.values?.condition === "restock"} className="mt-1" />
          <span>{t("Sealed and in date: put back on the shelf")}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="condition" value="discard" required defaultChecked={state.values?.condition === "discard"} className="mt-1" />
          <span>{t("Opened, damaged or doubtful: keep aside for destruction")}</span>
        </label>
      </fieldset>
      <Input name="reason" required minLength={3} maxLength={300} placeholder={t("Why? e.g. side effects, treatment changed")} aria-label={t("Reason for the return")} defaultValue={state.values?.reason} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
          {pending ? t("Saving…") : t("Record return")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

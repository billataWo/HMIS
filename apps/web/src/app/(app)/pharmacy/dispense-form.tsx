"use client";

import { ControlledBadge } from "@/components/controlled-badge";
import { useActionState, useState } from "react";
import { closePrescription, dispensePrescription, type FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import { etb } from "@/lib/format";
import type { PrescriptionItem } from "@/lib/api";
import { Substitute } from "./substitute";

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
  const t = useT();

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="prescriptionId" value={prescriptionId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && !pending && state.values?.step === "bill" && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Sent to the cashier. Dispense once the patient has paid.")}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">{t("Drug")}</th>
              <th className="py-1 pr-3 font-medium">{t("Directions")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("Prescribed")}</th>
              {prepayment && <th className="py-1 pr-3 text-right font-medium">{t("To cashier / paid")}</th>}
              <th className="py-1 pr-3 text-right font-medium">{t("Given")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("In stock")}</th>
              {canBill && <th className="py-1 pr-3 font-medium">{t("Send to cashier")}</th>}
              <th className="py-1 font-medium">{t("Give now")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ i, stock, paid, toBill, toGive }) => (
              <tr key={i.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 pr-3">
                  <span className="font-medium">{i.drug.genericName}</span> {i.drug.strength} {i.drug.form}
                  {i.drug.brandName && <span className="text-slate-500"> ({i.drug.brandName})</span>} <ControlledBadge c={i.drug.controlled} />
                  <span className="block text-xs text-slate-500">
                    {etb(i.drug.sellPrice, t)} / {i.drug.unit}
                  </span>
                  {i.substitutedFrom && (
                    <span className="block text-xs text-amber-800 dark:text-amber-300">
                      {t("Instead of {drug}", { drug: i.substitutedFrom })}
                      {i.substitutionReason && `: ${i.substitutionReason}`}
                    </span>
                  )}
                  {/* Only before anything of it is charged or handed over. */}
                  {i.billedQty === 0 && i.dispensedQty === 0 && <Substitute itemId={i.id} need={i.quantity} />}
                </td>
                <td className="py-2 pr-3">
                  {i.dose} {i.frequency}
                  {i.durationDays && ` × ${t("{n} d", { n: i.durationDays })}`}
                  {i.instructions && <span className="block text-xs text-slate-500">{i.instructions}</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{i.quantity}</td>
                {prepayment && (
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {i.billedQty} / <span className={paid < i.billedQty ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{paid}</span>
                  </td>
                )}
                <td className="py-2 pr-3 text-right tabular-nums">{i.dispensedQty}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${stock < i.quantity - i.dispensedQty ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
                  {stock}
                  {/* Several stores: the shortfall may be sitting in the main store. */}
                  {stock < i.quantity - i.dispensedQty && (i.elsewhere ?? 0) > 0 && (
                    <a href="/inventory/transfers" className="block text-xs font-normal whitespace-nowrap text-brand-700 hover:underline dark:text-brand-400">
                      {t("+{n} in other stores", { n: i.elsewhere ?? 0 })}
                    </a>
                  )}
                </td>
                {canBill && (
                  <td className="py-2 pr-3">
                    {!priced(i) ? (
                      <span className="text-xs text-slate-500">{t("free")}</span>
                    ) : i.billedQty < i.quantity ? (
                      <input
                        name={`bill_${i.id}`}
                        type="number"
                        min={0}
                        max={i.quantity - i.billedQty}
                        defaultValue={toBill}
                        aria-label={t("Units of {drug} to send to the cashier", { drug: i.drug.genericName })}
                        className={`${inputClass} w-20`}
                      />
                    ) : (
                      <span className="text-xs text-slate-500">{t("sent")}</span>
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
                      aria-label={t("Units of {drug} to give", { drug: i.drug.genericName })}
                      className={`${inputClass} w-20`}
                    />
                  ) : (
                    <span className="text-xs text-slate-500">{t("done")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {awaitingPayment && <p className="text-sm text-amber-700 dark:text-amber-400">{t("Waiting for the patient to pay at the cashier.")}</p>}
      <div className="flex flex-wrap gap-2">
        {canBill && (
          <button type="submit" name="step" value="bill" disabled={pending} className={canGive ? secondaryButtonClass : buttonClass}>
            {pending ? t("Saving…") : t("Send to cashier")}
          </button>
        )}
        <button type="submit" name="step" value="dispense" disabled={pending || (prepayment && !canGive)} className={canGive || !prepayment ? buttonClass : secondaryButtonClass}>
          {pending ? t("Saving…") : t(prepayment ? "Dispense paid" : "Dispense")}
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
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
        {t("Patient won't collect the rest? Close it")}
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <input type="hidden" name="prescriptionId" value={prescriptionId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <Input name="reason" required minLength={3} placeholder={t("Why? e.g. bought outside, out of stock, patient left")} aria-label={t("Reason")} defaultValue={state.values?.reason} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
          {pending ? t("Closing…") : t("Close prescription")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
          {t("Keep it open")}
        </button>
      </div>
    </form>
  );
}

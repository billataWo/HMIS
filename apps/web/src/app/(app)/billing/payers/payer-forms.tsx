"use client";

import { useActionState, useState } from "react";
import { savePayer, settlePayer, type FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { Payer } from "@/lib/api";
import { etb, PAYMENT_METHODS } from "@/lib/format";

/** Admin: add a credit company or insurer, or (with `payer`) change one. */
export function PayerForm({ payer }: { payer?: Payer }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePayer, {});
  const [open, setOpen] = useState(false);
  const t = useT();
  const v = { ...(payer && { name: payer.name, phone: payer.phone ?? "", contactPerson: payer.contactPerson ?? "" }), ...state.values };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={payer ? `${secondaryButtonClass} px-3 py-1.5 text-xs` : buttonClass}>
        {t(payer ? "Edit" : "Add payer")}
      </button>
    );
  }
  return (
    <form action={action} className="surface space-y-3 p-4">
      {payer && <input type="hidden" name="id" value={payer.id} />}
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && !pending && <Notice tone="success">{t("Saved.")}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        {!payer && (
          <Field label={t("Type")}>
            <select name="type" defaultValue={state.values?.type ?? "CREDIT"} className={inputClass}>
              <option value="CREDIT">{t("Credit (company, organisation)")}</option>
              <option value="INSURANCE">{t("Insurance")}</option>
            </select>
          </Field>
        )}
        <Field label={t("Name")} error={state.fieldErrors?.name && t(state.fieldErrors.name)}>
          <Input name="name" required defaultValue={v.name} />
        </Field>
        <Field label={t("Phone")}>
          <Input name="phone" type="tel" defaultValue={v.phone} />
        </Field>
        <Field label={t("Contact person")}>
          <Input name="contactPerson" defaultValue={v.contactPerson} />
        </Field>
        <Field label={t("Patient's co-payment (%)")} error={state.fieldErrors?.coPayPercent && t(state.fieldErrors.coPayPercent)}>
          <Input name="coPayPercent" type="number" min={0} max={100} step="0.5" defaultValue={state.values?.coPayPercent ?? (payer?.coPayPercent ? String(Number(payer.coPayPercent)) : "0")} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="requiresAuthorization" defaultChecked={state.values ? state.values.requiresAuthorization === "on" : payer?.requiresAuthorization} /> {t("Each visit needs their authorization number")}
      </label>
      {payer && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={payer.active} /> {t("Active (offered when invoicing)")}
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? t("Saving…") : t("Save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          {t("Close")}
        </button>
      </div>
    </form>
  );
}

/** One payment from the payer (cheque, bank transfer…), applied to its unpaid invoices oldest first. */
export function SettlementForm({ payerId, balance }: { payerId: string; balance: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(settlePayer, {});
  const [method, setMethod] = useState("BANK_TRANSFER");
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="payerId" value={payerId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && !pending && <Notice tone="success">{t("Payment recorded against the oldest invoices first.")}</Notice>}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {t.rich("They owe {amount}. The payment is applied to the oldest unpaid invoices first.", { amount: <strong>{etb(balance, t)}</strong> })}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Method")}>
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {Object.entries(PAYMENT_METHODS).map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Amount (ETB)")} error={err.amount}>
          <Input key={balance} name="amount" type="number" min="0.01" step="0.01" max={balance} required defaultValue={balance} />
        </Field>
        {method !== "CASH" && (
          <Field label={t("Cheque or transaction number")} error={err.reference}>
            <Input name="reference" required />
          </Field>
        )}
      </div>
      <button type="submit" disabled={pending || Number(balance) <= 0} className={buttonClass}>
        {pending ? t("Recording…") : t("Record payment")}
      </button>
    </form>
  );
}

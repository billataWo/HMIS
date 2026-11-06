"use client";

import { useActionState, useState } from "react";
import { savePayer, settlePayer, type FormState } from "@/app/actions";
import { Alert, buttonClass, Field, Input, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { Payer } from "@/lib/api";
import { etb, PAYMENT_METHODS } from "@/lib/format";

/** Admin: add a credit company or insurer, or (with `payer`) change one. */
export function PayerForm({ payer }: { payer?: Payer }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePayer, {});
  const [open, setOpen] = useState(false);
  const v = { ...(payer && { name: payer.name, phone: payer.phone ?? "", contactPerson: payer.contactPerson ?? "" }), ...state.values };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={payer ? `${secondaryButtonClass} px-3 py-1.5 text-xs` : buttonClass}>
        {payer ? "Edit" : "Add payer"}
      </button>
    );
  }
  return (
    <form action={action} className="surface space-y-3 p-4">
      {payer && <input type="hidden" name="id" value={payer.id} />}
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && <Notice tone="success">Saved.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        {!payer && (
          <Field label="Type">
            <select name="type" defaultValue={state.values?.type ?? "CREDIT"} className={inputClass}>
              <option value="CREDIT">Credit (company, organisation)</option>
              <option value="INSURANCE">Insurance</option>
            </select>
          </Field>
        )}
        <Field label="Name" error={state.fieldErrors?.name}>
          <Input name="name" required defaultValue={v.name} />
        </Field>
        <Field label="Phone">
          <Input name="phone" type="tel" defaultValue={v.phone} />
        </Field>
        <Field label="Contact person">
          <Input name="contactPerson" defaultValue={v.contactPerson} />
        </Field>
      </div>
      {payer && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={payer.active} /> Active (offered when invoicing)
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          Close
        </button>
      </div>
    </form>
  );
}

/** One payment from the payer (cheque, bank transfer…), applied to its unpaid invoices oldest first. */
export function SettlementForm({ payerId, balance }: { payerId: string; balance: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(settlePayer, {});
  const [method, setMethod] = useState("BANK_TRANSFER");
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="payerId" value={payerId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && <Notice tone="success">Payment recorded against the oldest invoices first.</Notice>}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        They owe <strong>{etb(balance)}</strong>. The payment is applied to the oldest unpaid invoices first.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Method">
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {Object.entries(PAYMENT_METHODS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (ETB)" error={err.amount}>
          <Input key={balance} name="amount" type="number" min="0.01" step="0.01" max={balance} required defaultValue={balance} />
        </Field>
        {method !== "CASH" && (
          <Field label="Cheque or transaction number" error={err.reference}>
            <Input name="reference" required />
          </Field>
        )}
      </div>
      <button type="submit" disabled={pending || Number(balance) <= 0} className={buttonClass}>
        {pending ? "Recording…" : "Record payment"}
      </button>
    </form>
  );
}

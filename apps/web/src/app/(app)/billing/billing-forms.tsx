"use client";

import { useActionState, useState } from "react";
import { closeCash, createInvoice, recordPayment, voidInvoice, type FormState } from "@/app/actions";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import { etb, PAYMENT_METHODS } from "@/lib/format";

export function InvoiceForm({ visitId, subtotal, canDiscount }: { visitId: string; subtotal: string; canDiscount: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createInvoice, {});
  const [payer, setPayer] = useState(state.values?.payerType ?? "SELF");
  const [discounting, setDiscounting] = useState(false);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="visitId" value={visitId} />
      {state.error && <Alert>{state.error}</Alert>}
      <div className="flex flex-wrap items-start gap-2">
        <select name="payerType" value={payer} onChange={(e) => setPayer(e.target.value)} aria-label="Who pays" className={`${inputClass} w-auto`}>
          <option value="SELF">Patient pays</option>
          <option value="CREDIT">Credit (company)</option>
          <option value="INSURANCE">Insurance</option>
        </select>
        {payer !== "SELF" && (
          <div className="min-w-48 flex-1">
            <Input name="payerName" placeholder={payer === "CREDIT" ? "Company name" : "Insurer name"} defaultValue={state.values?.payerName} aria-label="Payer name" />
            {err.payerName && <span className="text-xs text-red-600">{err.payerName}</span>}
          </div>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating…" : `Create invoice · ${etb(subtotal)}`}
        </button>
      </div>
      {canDiscount &&
        (discounting ? (
          <div className="flex flex-wrap items-start gap-2">
            <div>
              <Input name="discount" type="number" min={0} step="0.01" placeholder="Discount (ETB)" defaultValue={state.values?.discount} aria-label="Discount" className="w-36" />
              {err.discount && <span className="text-xs text-red-600">{err.discount}</span>}
            </div>
            <div className="min-w-48 flex-1">
              <Input name="discountReason" placeholder="Reason for discount" defaultValue={state.values?.discountReason} aria-label="Discount reason" />
              {err.discountReason && <span className="text-xs text-red-600">{err.discountReason}</span>}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setDiscounting(true)} className="text-xs text-teal-700 hover:underline dark:text-teal-400">
            Give a discount
          </button>
        ))}
    </form>
  );
}

export function PaymentForm({ invoiceId, balance }: { invoiceId: string; balance: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordPayment, {});
  const [method, setMethod] = useState("CASH");
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">Payment recorded.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Method">
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (ETB)" error={err.amount}>
          {/* key resets the default to the new balance after each payment */}
          <Input key={balance} name="amount" type="number" min="0.01" step="0.01" max={balance} required defaultValue={balance} />
        </Field>
        {method !== "CASH" && (
          <Field label="Transaction reference" error={err.reference}>
            <Input name="reference" required placeholder={method === "BANK_TRANSFER" ? "Bank reference" : "Transaction ID"} />
          </Field>
        )}
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Recording…" : "Record payment"}
      </button>
    </form>
  );
}

export function VoidForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(voidInvoice, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-red-700 hover:underline dark:text-red-400">
        Void this invoice
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {state.error && <Alert>{state.error}</Alert>}
      <Input name="reason" required minLength={5} placeholder="Why is this invoice being voided?" aria-label="Void reason" />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} bg-red-700 hover:bg-red-800`}>
          {pending ? "Voiding…" : "Void invoice"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          Keep it
        </button>
      </div>
    </form>
  );
}

export function CloseCashForm({ expectedCash }: { expectedCash: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeCash, {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <p className="text-sm">
        Cash you should have: <strong>{etb(expectedCash)}</strong>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cash counted in the drawer (ETB)">
          <Input name="countedCash" type="number" min={0} step="0.01" required defaultValue={state.values?.countedCash} />
        </Field>
        <Field label="Note" hint="Explain any difference">
          <Input name="note" defaultValue={state.values?.note} />
        </Field>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Closing…" : "Close my cash for today"}
      </button>
    </form>
  );
}

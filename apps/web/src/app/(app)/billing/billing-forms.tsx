"use client";

import { useActionState, useState } from "react";
import { closeCash, createInvoice, recordPayment, removeInvoiceLine, reversePayment, setVisitCoverage, voidInvoice, type FormState } from "@/app/actions";
import { CoverageChoice } from "@/components/coverage-choice";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { CoverageOption, Payer } from "@/lib/api";
import { DISCOUNT_CATEGORIES, etb, PAYMENT_METHODS } from "@/lib/format";

export function InvoiceForm({
  visitId,
  subtotal,
  canDiscount,
  payers = [],
  sponsor,
}: {
  visitId: string;
  subtotal: string;
  canDiscount: boolean;
  payers?: Payer[];
  /** The visit is billed to a payer: covered lines go to it; this form settles who pays the rest. */
  sponsor?: { name: string; allCovered: boolean };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createInvoice, {});
  const [payer, setPayer] = useState(state.values?.payerType ?? "SELF");
  const [payerId, setPayerId] = useState(state.values?.payerId ?? "");
  const choices = payers.filter((p) => p.type === payer);
  const [discounting, setDiscounting] = useState(false);
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="visitId" value={visitId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      {sponsor && (
        <p className="text-xs text-slate-500">
          {t("Covered lines go on an invoice to {payer}, with the patient's co-payment on it.", { payer: sponsor.name })}
          {!sponsor.allCovered && ` ${t("Who pays the other lines:")}`}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <select
          name="payerType"
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
          aria-label={t("Who pays")}
          className={`${inputClass} w-auto ${sponsor?.allCovered ? "hidden" : ""}`}
        >
          <option value="SELF">{t("Patient pays")}</option>
          <option value="CREDIT">{t("Credit (company)")}</option>
          <option value="INSURANCE">{t("Insurance")}</option>
        </select>
        {payer !== "SELF" && (
          <div className="min-w-48 flex-1 space-y-1">
            {choices.length > 0 && (
              <select name="payerId" value={payerId} onChange={(e) => setPayerId(e.target.value)} aria-label={t("Payer")} className={inputClass}>
                <option value="">{t(payer === "CREDIT" ? "A new company…" : "A new insurer…")}</option>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {!payerId && (
              <Input name="payerName" placeholder={t(payer === "CREDIT" ? "Company name" : "Insurer name")} defaultValue={state.values?.payerName} aria-label={t("Payer name")} />
            )}
            {err.payerName && <span className="text-xs text-red-600">{err.payerName}</span>}
          </div>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? t("Creating…") : `${t(sponsor ? "Create invoices" : "Create invoice")} · ${etb(subtotal, t)}`}
        </button>
      </div>
      {canDiscount &&
        (discounting ? (
          <div className="flex flex-wrap items-start gap-2">
            <div>
              <Input name="discount" type="number" min={0} step="0.01" placeholder={t("Discount (ETB)")} defaultValue={state.values?.discount} aria-label={t("Discount")} className="w-36" />
              {err.discount && <span className="text-xs text-red-600">{err.discount}</span>}
            </div>
            <div>
              <select name="discountCategory" defaultValue={state.values?.discountCategory ?? ""} aria-label={t("Kind of discount")} className={`${inputClass} w-auto`}>
                <option value="" disabled>
                  {t("Why…")}
                </option>
                {Object.entries(DISCOUNT_CATEGORIES)
                  .filter(([k]) => k !== "UNCATEGORISED")
                  .map(([k, label]) => (
                    <option key={k} value={k}>
                      {t(label)}
                    </option>
                  ))}
              </select>
              {err.discountCategory && <span className="block text-xs text-red-600">{err.discountCategory}</span>}
            </div>
            <div className="min-w-48 flex-1">
              <Input name="discountReason" placeholder={t("Details (letter number, name…; needed for “Other”)")} defaultValue={state.values?.discountReason} aria-label={t("Discount details")} />
              {err.discountReason && <span className="text-xs text-red-600">{err.discountReason}</span>}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setDiscounting(true)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
            {t("Give a discount")}
          </button>
        ))}
    </form>
  );
}

/**
 * Changes who pays for a visit before it is billed (the patient shows their company card at the
 * counter, or it was chosen by mistake): its lines are priced again for the new payer.
 */
export function VisitPayerForm({ visitId, coverages }: { visitId: string; coverages: CoverageOption[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setVisitCoverage, {});
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
        {t("Change who pays")}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="visitId" value={visitId} />
      <CoverageChoice coverages={coverages} className="w-auto min-w-48" />
      <button disabled={pending} className={`${secondaryButtonClass} px-3 py-1 text-xs`}>
        {pending ? t("Saving…") : t("Apply")}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
        {t("Cancel")}
      </button>
      {state.error && <span className="w-full text-xs text-red-700 dark:text-red-400">{t(state.error)}</span>}
    </form>
  );
}

export function PaymentForm({ invoiceId, balance }: { invoiceId: string; /** What the patient pays now: the balance, or their co-payment left on a payer's invoice. */ balance: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordPayment, {});
  const [method, setMethod] = useState("CASH");
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Payment recorded.")}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Method")}>
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
              <option key={v} value={v}>
                {t(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Amount (ETB)")} error={err.amount}>
          {/* key resets the default to the new balance after each payment */}
          <Input key={balance} name="amount" type="number" min="0.01" step="0.01" max={balance} required defaultValue={balance} />
        </Field>
        {method !== "CASH" && (
          <Field label={t("Transaction reference")} error={err.reference}>
            <Input name="reference" required placeholder={t(method === "BANK_TRANSFER" ? "Bank reference" : "Transaction ID")} />
          </Field>
        )}
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? t("Recording…") : t("Record payment")}
      </button>
    </form>
  );
}

export function VoidForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(voidInvoice, {});
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-red-700 hover:underline dark:text-red-400">
        {t("Void this invoice")}
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <Input name="reason" required minLength={5} placeholder={t("Why is this invoice being voided?")} aria-label={t("Void reason")} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} bg-red-700 hover:bg-red-800`}>
          {pending ? t("Voiding…") : t("Void invoice")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          {t("Keep it")}
        </button>
      </div>
    </form>
  );
}

/**
 * Admin, per invoice line: refund a service the patient never received. Drug lines can be refunded
 * in part (only units not handed over, or returned to the pharmacy).
 */
export function RemoveLineForm({ invoiceId, chargeId, isDrug, quantity, refundDue }: { invoiceId: string; chargeId: string; isDrug: boolean; quantity: number; refundDue: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(removeInvoiceLine, {});
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("CASH");
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-red-700 hover:underline dark:text-red-400">
        {t(refundDue ? "Refund" : "Remove")}
      </button>
    );
  }
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3 text-left dark:border-red-900/60 dark:bg-red-950/30">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="chargeId" value={chargeId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {t("Only for a service the patient did not receive: a test whose sample was not taken, drugs not handed over (or brought back, once the pharmacy has recorded the return), or a consultation they left before.")}
      </p>
      <Input name="reason" required minLength={5} placeholder={t("Why? e.g. patient left before the sample")} aria-label={t("Reason")} defaultValue={state.values?.reason} />
      <div className="flex flex-wrap gap-2">
        {isDrug && quantity > 1 && (
          <Input name="quantity" type="number" min={1} max={quantity} defaultValue={state.values?.quantity ?? quantity} aria-label={t("Units to refund")} className="w-28" title={t("Units to refund")} />
        )}
        {refundDue && (
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t("Refund method")} className={`${inputClass} w-auto`}>
            {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
              <option key={v} value={v}>
                {t("Refund by {method}", { method: t.lang === "am" ? t(l) : l.toLowerCase() })}
              </option>
            ))}
          </select>
        )}
        {refundDue && method !== "CASH" && <Input name="reference" placeholder={t("Refund transaction ID")} aria-label={t("Refund reference")} className="w-48" />}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} bg-red-700 px-3 py-1.5 text-xs hover:bg-red-800`}>
          {pending ? t("Saving…") : t(refundDue ? "Remove and refund" : "Remove line")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
          {t("Keep it")}
        </button>
      </div>
    </form>
  );
}

/**
 * Closes the cashier's shift: the float the drawer started with plus the cash taken is what should
 * be there; what was counted, what stays in the drawer for the next shift, and who took the rest.
 */
export function CloseCashForm({ cashTaken, suggestedFloat }: { cashTaken: string; suggestedFloat: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeCash, {});
  const [float, setFloat] = useState(state.values?.openingFloat ?? suggestedFloat);
  const [counted, setCounted] = useState(state.values?.countedCash ?? "");
  const [left, setLeft] = useState(state.values?.floatLeft ?? "0");
  const expected = (Number(float) || 0) + Number(cashTaken);
  const handOver = Math.max(0, (Number(counted) || 0) - (Number(left) || 0));
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Shift closed. Any payment from now on starts your next shift.")}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Float at the start (ETB)")} hint={t("Change the drawer started with")} error={err.openingFloat}>
          <Input name="openingFloat" type="number" min={0} step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} />
        </Field>
        <Field label={t("Cash counted in the drawer (ETB)")} error={err.countedCash}>
          <Input name="countedCash" type="number" min={0} step="0.01" required value={counted} onChange={(e) => setCounted(e.target.value)} />
        </Field>
        <Field label={t("Left in the drawer (ETB)")} hint={t("Float for the next shift")} error={err.floatLeft}>
          <Input name="floatLeft" type="number" min={0} step="0.01" value={left} onChange={(e) => setLeft(e.target.value)} />
        </Field>
      </div>
      <p className="text-sm">
        {t.rich("Cash you should have: {expected} (float {float} + taken {taken})", {
          expected: <strong>{etb(expected, t)}</strong>,
          float: etb(Number(float) || 0, t),
          taken: etb(cashTaken, t),
        })}
        {counted !== "" && Number(counted) !== expected && (
          <strong className="text-red-700 dark:text-red-400">
            {" "}
            · {t(Number(counted) > expected ? "over {amount}" : "short {amount}", { amount: etb(Math.abs(Number(counted) - expected), t) })}
          </strong>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Handed over ({amount}) to", { amount: etb(handOver, t) })} hint={t("The next cashier, the admin, the bank")}>
          <Input name="handedTo" defaultValue={state.values?.handedTo} />
        </Field>
        <Field label={t("Note")} hint={t("Explain any difference")}>
          <Input name="note" defaultValue={state.values?.note} />
        </Field>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? t("Closing…") : t("Close my shift")}
      </button>
    </form>
  );
}

/** Admin: undo a payment recorded by mistake, saying why. */
export function ReversePaymentForm({ paymentId }: { paymentId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reversePayment, {});
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-red-700 hover:underline dark:text-red-400">
        {t("Reverse")}
      </button>
    );
  }
  return (
    <form action={action} className="mt-1 space-y-1">
      <input type="hidden" name="paymentId" value={paymentId} />
      <input name="reason" required minLength={5} placeholder={t("What was wrong (amount, method, patient)")} aria-label={t("Why it is reversed")} className={`${inputClass} py-1 text-xs`} />
      <div className="flex gap-2">
        <button disabled={pending} className={`${buttonClass} bg-red-700 px-2 py-1 text-xs hover:bg-red-800`}>
          {pending ? t("Reversing…") : t("Reverse payment")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          {t("Cancel")}
        </button>
      </div>
      {state.error && <p className="text-xs text-red-700">{t(state.error)}</p>}
    </form>
  );
}

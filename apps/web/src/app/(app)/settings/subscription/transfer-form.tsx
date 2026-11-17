"use client";

import { useActionState } from "react";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, Notice } from "@/components/ui";
import { reportTransfer, type TransferState } from "./actions";

/** The clinic reports a bank transfer for an invoice; HMIS checks its statement and confirms it. */
export function TransferForm({ invoiceId, amount, today }: { invoiceId: string; amount: string; today: string }) {
  const [state, action, pending] = useActionState<TransferState, FormData>(reportTransfer.bind(null, invoiceId), {});
  const t = useT();
  if (state.done) {
    return <Notice tone="success">{t("Thank you. HMIS will confirm the transfer once it shows on the bank statement, usually within one working day.")}</Notice>;
  }
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3 sm:items-start">
      {state.error && (
        <div className="sm:col-span-3">
          <Alert>{t(state.error)}</Alert>
        </div>
      )}
      <Field label={t("Transaction number")} hint={t("On the bank receipt (FT…)")}>
        <Input name="reference" required minLength={4} maxLength={100} autoComplete="off" />
      </Field>
      <Field label={t("Amount (ETB)")}>
        <Input name="amount" required inputMode="decimal" defaultValue={amount} pattern="\d+(\.\d{1,2})?" />
      </Field>
      <Field label={t("Date paid")}>
        <Input name="paidAt" type="date" required defaultValue={today} max={today} />
      </Field>
      <div className="sm:col-span-3">
        <button disabled={pending} className={buttonClass}>
          {pending ? t("Sending…") : t("I have paid by bank transfer")}
        </button>
      </div>
    </form>
  );
}

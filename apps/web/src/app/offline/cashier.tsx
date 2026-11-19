"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { Badge, buttonClass, Card, EmptyState, inputClass } from "@/components/ui";
import { type OfflineMethod, payVisit } from "@/lib/offline/actions";
import { PAYMENT_METHODS } from "@/lib/format";
import type { OfflineBill, OfflinePayment } from "@/lib/offline/view";
import { fullName, money, PatientLine, type TabProps, useBusy } from "./shared";

export function Cashier({ view, userId }: TabProps) {
  const [receipt, setReceipt] = useState<OfflinePayment | null>(null);
  const t = useT();
  // What this PC took, by method: what the drawer should hold for the money taken offline.
  const totals = Object.entries(
    view.payments.reduce<Record<string, number>>((s, p) => ({ ...s, [p.method]: (s[p.method] ?? 0) + Math.round(p.amount * 100) }), {}),
  );
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        {view.bills.map((b) => (
          // Re-created when the amount owed changes (after a part payment), so the amount resets.
          <Bill key={`${b.id}-${b.subtotal}`} bill={b} userId={userId} />
        ))}
        {!view.bills.length && <EmptyState title={t("Nothing waiting to be paid on this PC")} />}
      </div>
      <Card title={t("Taken on this PC")} description={t("Provisional receipts; the official receipt comes with the invoice once this is sent.")}>
        <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {view.payments.map((p) => (
            <li key={p.opId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {fullName(p.patient)} · {money(p.amount, t)}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={p.sent ? "success" : "warning"}>{t(p.sent ? "Sent" : "Waiting")}</Badge>
                <button
                  aria-label={t("Print receipt")}
                  onClick={() => {
                    setReceipt(p);
                    setTimeout(() => window.print(), 50);
                  }}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Printer aria-hidden className="size-4" />
                </button>
              </span>
            </li>
          ))}
          {!view.payments.length && <li className="py-3 text-sm text-slate-500">{t("None yet.")}</li>}
        </ul>
        {totals.length > 0 && (
          <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
            {totals.map(([method, cents]) => (
              <div key={method} className="flex justify-between gap-3">
                <dt className="text-slate-500">{t(PAYMENT_METHODS[method] ?? method)}</dt>
                <dd className="font-medium text-slate-900 tabular-nums dark:text-white">{money(cents / 100, t)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
      {/* Printed on its own: the workspace itself is hidden when printing. Printed in English, like the official receipt. */}
      {/* i18n-ignore-start */}
      {receipt &&
        createPortal(
          <div className="hidden p-8 text-black print:block">
            <h1 className="text-xl font-semibold">{view.snap.me.tenant.name}</h1>
            <p className="mt-1 text-sm">PROVISIONAL RECEIPT (recorded offline)</p>
            <p className="mt-4">Patient: {fullName(receipt.patient)}</p>
            <p>
              Amount: {money(receipt.amount)} ({PAYMENT_METHODS[receipt.method] ?? receipt.method})
            </p>
            <p>Date: {new Date(receipt.at).toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" })}</p>
            <p>Cashier: {view.snap.me.fullName}</p>
            <p className="mt-4 text-sm">The official receipt is issued when this payment reaches the HMIS server.</p>
          </div>,
          document.body,
        )}
      {/* i18n-ignore-end */}
    </div>
  );
}

const cents = (s: string) => Math.round(Number(s) * 100);

function Bill({ bill, userId }: { bill: OfflineBill; userId: string }) {
  const owed = cents(bill.subtotal);
  const [amount, setAmount] = useState(bill.subtotal);
  const [method, setMethod] = useState<OfflineMethod>("CASH");
  const [reference, setReference] = useState("");
  const [busy, run] = useBusy();
  const t = useT();
  const n = Number(amount);
  const amountOk = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && n > 0;
  const tooMuch = amountOk && cents(amount) > owed;
  const valid = amountOk && !tooMuch && (method === "CASH" || reference.trim().length >= 4);
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PatientLine p={bill.patient} />
        {bill.offline && <Badge tone="violet">{t("Added offline")}</Badge>}
      </div>
      <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-400">
        {bill.charges.map((c) => (
          <li key={c.id} className="flex justify-between gap-3">
            <span>
              {c.description}
              {c.quantity > 1 ? ` × ${c.quantity}` : ""}
            </span>
            <span className="tabular-nums">{money(Number(c.unitPrice) * c.quantity, t)}</span>
          </li>
        ))}
        {Number(bill.paid ?? 0) > 0 && (
          <li className="flex justify-between gap-3 text-emerald-700 dark:text-emerald-400">
            <span>{t("Paid so far")}</span>
            <span className="tabular-nums">−{money(bill.paid!, t)}</span>
          </li>
        )}
      </ul>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <p className="font-semibold text-slate-900 tabular-nums dark:text-white">{t("Owed {amount}", { amount: money(bill.subtotal, t) })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={method} onChange={(e) => setMethod(e.target.value as OfflineMethod)} className={`${inputClass} w-36`} aria-label={t("Payment method")}>
            <option value="CASH">{t("Cash")}</option>
            {/* i18n-ignore: a brand name */}
            <option value="TELEBIRR">Telebirr</option>
            <option value="BANK_TRANSFER">{t("Bank transfer")}</option>
          </select>
          {method !== "CASH" && (
            <input
              aria-label={t(method === "TELEBIRR" ? "Telebirr transaction number" : "Bank reference")}
              placeholder={t("Transaction no.")}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={`${inputClass} w-40`}
            />
          )}
          <input aria-label={t("Amount received")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} w-32 tabular-nums`} />
          <button
            disabled={busy || !valid}
            onClick={() => run(() => payVisit(userId, bill.id, bill.patient, Math.round(n * 100) / 100, method, method !== "CASH" ? reference.trim() : undefined))}
            className={buttonClass}
          >
            {t("Take payment")}
          </button>
        </div>
      </div>
      {tooMuch && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{t("More than is owed ({amount}): take only what is owed.", { amount: money(bill.subtotal, t) })}</p>
      )}
      {amountOk && !tooMuch && cents(amount) < owed && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{t("Less than is owed: the rest stays owed.")}</p>}
      {method === "TELEBIRR" && <p className="mt-2 text-sm text-slate-500">{t("Check the Telebirr message on the patient's phone and copy its transaction number.")}</p>}
      {method === "BANK_TRANSFER" && <p className="mt-2 text-sm text-slate-500">{t("Check the bank's confirmation and copy its reference number.")}</p>}
    </section>
  );
}

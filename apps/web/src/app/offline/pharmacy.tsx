"use client";

import { useT } from "@/components/lang-provider";
import { Badge, buttonClass, EmptyState, secondaryButtonClass } from "@/components/ui";
import type { PharmacyPrescription } from "@/lib/api";
import { billDrugs, dispense } from "@/lib/offline/actions";
import { money, PatientLine, type TabProps, useBusy } from "./shared";

export function Pharmacy({ view, userId }: TabProps) {
  const open = view.pharmacy.filter((rx) => rx.status === "PENDING" || rx.status === "PARTIALLY_DISPENSED");
  const t = useT();
  return (
    <div className="space-y-4">
      {open.map((rx) => (
        <Rx key={rx.id} rx={rx} userId={userId} prepayment={view.snap.prepayment} />
      ))}
      {!open.length && <EmptyState title={t("No prescriptions waiting on this PC")} />}
    </div>
  );
}

function Rx({ rx, userId, prepayment }: { rx: PharmacyPrescription; userId: string; prepayment: boolean }) {
  const [busy, run] = useBusy();
  const t = useT();
  const lines = rx.items.map((it) => {
    const remaining = it.quantity - it.dispensedQty;
    const unbilled = Math.max(0, it.quantity - it.billedQty);
    // Pay-first: only what has been paid for can be handed over.
    const handable = Math.max(0, Math.min(remaining, it.billedQty - it.dispensedQty, prepayment ? (it.paidQty ?? 0) - it.dispensedQty : Infinity));
    return { it, remaining, unbilled, handable };
  });
  const toBill = lines.filter((l) => l.unbilled > 0);
  const toHand = lines.filter((l) => l.handable > 0);
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PatientLine p={rx.visit.patient} />
        <Badge tone={rx.status === "PENDING" ? "warning" : "info"}>{t(rx.status === "PENDING" ? "To dispense" : "Partly dispensed")}</Badge>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {lines.map(({ it, remaining, handable }) => (
          <li key={it.id} className="flex flex-wrap justify-between gap-3">
            <span>
              <span className="font-medium">{it.drug.genericName}</span> {it.drug.strength} · {it.dose} {it.frequency} · {it.quantity} {it.drug.unit}
            </span>
            <span className="text-slate-500">
              {t("{n} to go · billed {billed}", { n: remaining, billed: it.billedQty })}
              {prepayment ? ` · ${t("paid {n}", { n: it.paidQty ?? 0 })}` : ""}
              {it.inStock !== undefined && it.inStock < remaining ? (
                <span className="ml-2 text-amber-700 dark:text-amber-300">{t("only {n} in stock", { n: it.inStock })}</span>
              ) : null}
              {handable > 0 ? <span className="ml-2 text-emerald-700 dark:text-emerald-400">{t("{n} ready", { n: handable })}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {toBill.length > 0 && (
          <button
            disabled={busy}
            onClick={() =>
              run(() =>
                billDrugs(
                  userId,
                  rx,
                  toBill.map((l) => ({ itemId: l.it.id, quantity: l.unbilled, name: `${l.it.drug.genericName} ${l.it.drug.strength ?? ""}`.trim(), price: l.it.drug.sellPrice })),
                ),
              )
            }
            className={secondaryButtonClass}
          >
            {t("Bill {amount}", { amount: money(toBill.reduce((s, l) => s + l.unbilled * Number(l.it.drug.sellPrice), 0), t) })}
          </button>
        )}
        <button
          disabled={busy || !toHand.length}
          onClick={() => run(() => dispense(userId, rx, toHand.map((l) => ({ itemId: l.it.id, quantity: l.handable }))))}
          className={buttonClass}
          title={!toHand.length ? t(prepayment ? "Bill first; the patient pays at the cashier" : "Bill first") : undefined}
        >
          {t("Hand over")}
        </button>
      </div>
    </section>
  );
}

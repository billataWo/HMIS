"use client";

import { Syringe, X } from "lucide-react";
import { useActionState, useTransition } from "react";
import { addProcedure, removeProcedure, type FormState } from "@/app/actions";
import { Alert, Badge, buttonClass, Input, inputClass } from "@/components/ui";
import type { ProcedureCharge, Service } from "@/lib/api";
import { etb, formatTime } from "@/lib/format";

/**
 * Procedures given in the room (injection, IV fluids, dressing, ECG…). Recording one creates its
 * charge, so the cashier bills it with the rest of the visit.
 */
export function ProceduresPanel({ visitId, items, procedures, editable }: { visitId: string; items: ProcedureCharge[]; procedures: Service[]; editable: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addProcedure, {});
  const [removing, start] = useTransition();

  return (
    <section id="procedures" className="surface scroll-mt-6 space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <Syringe aria-hidden className="size-4 text-slate-400" />
        Procedures
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No procedures recorded.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{c.description}</span>
                {c.quantity > 1 && <span className="text-slate-500"> × {c.quantity}</span>}
                <span className="text-xs text-slate-500"> · {formatTime(c.createdAt)}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{etb(Number(c.unitPrice) * c.quantity)}</span>
                {c.invoiceId ? (
                  <Badge tone="success">Billed</Badge>
                ) : (
                  editable && (
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => start(() => removeProcedure(visitId, c.id))}
                      aria-label={`Remove ${c.description}`}
                      className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700 dark:hover:bg-slate-800"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable &&
        (procedures.length === 0 ? (
          <p className="text-xs text-slate-500">No procedures in the price list yet. An admin adds them under Settings → Prices.</p>
        ) : (
          <form action={action} className="flex flex-wrap items-start gap-2">
            <input type="hidden" name="visitId" value={visitId} />
            <select name="serviceId" required aria-label="Procedure" className={`${inputClass} min-w-56 flex-1`} defaultValue="">
              <option value="" disabled>
                Choose a procedure…
              </option>
              {procedures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {Number(s.price).toFixed(2)} ETB
                </option>
              ))}
            </select>
            <Input name="quantity" type="number" min={1} max={50} defaultValue={1} aria-label="How many" className="w-20" />
            <button type="submit" disabled={pending} className={buttonClass}>
              {pending ? "Adding…" : "Record"}
            </button>
            {state.error && (
              <div className="w-full">
                <Alert>{state.error}</Alert>
              </div>
            )}
          </form>
        ))}
    </section>
  );
}

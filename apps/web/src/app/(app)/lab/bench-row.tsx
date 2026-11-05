"use client";

import { useActionState } from "react";
import { labStep, type FormState } from "@/app/actions";
import { LAB_STATUS, LabValue, rangeText } from "@/components/lab-result";
import { Alert, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { LabWorkOrder } from "@/lib/api";

const small = "px-3 py-1 text-xs";

export function BenchRow({ o, prepayment }: { o: LabWorkOrder; prepayment: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const t = o.labTest;
  const range = rangeText(t);
  const numeric = !t.resultOptions.length && range !== null;
  const unpaid = prepayment && o.status === "ORDERED" && !o.paid;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-medium">{t.name}</span>
          {t.loincCode && <span className="ml-1 font-mono text-xs text-zinc-500">LOINC {t.loincCode}</span>}
          {o.sampleId && <span className="ml-2 font-mono text-xs">· {o.sampleId}</span>}
        </span>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {unpaid && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-900 dark:bg-red-950 dark:text-red-100">Not paid</span>}
          {LAB_STATUS[o.status]}
        </span>
      </div>
      {state.error && <Alert>{state.error}</Alert>}

      {o.status === "ORDERED" &&
        (unpaid ? (
          <p className="text-sm text-zinc-500">Send the patient to the cashier before taking the sample.</p>
        ) : (
          <form action={action} className="flex flex-wrap gap-2">
            <input type="hidden" name="orderId" value={o.id} />
            <input type="hidden" name="step" value="collect" />
            <input name="sampleId" placeholder="Sample ID (optional)" aria-label="Sample ID" className={`${inputClass} w-48`} />
            <button disabled={pending} className={`${buttonClass} ${small}`}>
              Sample collected
            </button>
          </form>
        ))}

      {(o.status === "SAMPLE_COLLECTED" || o.status === "RESULTED") && (
        <form action={action} className="flex flex-wrap items-start gap-2">
          <input type="hidden" name="orderId" value={o.id} />
          <input type="hidden" name="step" value="result" />
          {t.resultOptions.length ? (
            <select name="value" required defaultValue={o.resultValue ?? ""} aria-label="Result" className={`${inputClass} w-48`}>
              <option value="" disabled>
                Choose result
              </option>
              {t.resultOptions.map((opt) => (
                <option key={opt}>{opt}</option>
              ))}
            </select>
          ) : numeric ? (
            <label className="flex items-center gap-1 text-sm">
              <input name="value" required inputMode="decimal" defaultValue={o.resultValue ?? ""} aria-label="Result" className={`${inputClass} w-28`} />
              <span className="text-xs text-zinc-500">
                {t.unit} (ref {range})
              </span>
            </label>
          ) : (
            <textarea name="value" required rows={2} defaultValue={o.resultValue ?? ""} aria-label="Result" className={`${inputClass} min-w-64 flex-1`} />
          )}
          <input name="note" placeholder="Comment (optional)" defaultValue={o.resultNote ?? ""} aria-label="Comment" className={`${inputClass} w-56`} />
          <button disabled={pending} className={`${o.status === "RESULTED" ? secondaryButtonClass : buttonClass} ${small}`}>
            {o.status === "RESULTED" ? "Correct result" : "Save result"}
          </button>
        </form>
      )}

      {o.status === "RESULTED" && (
        <form action={action} className="flex flex-wrap items-center gap-3 rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
          <input type="hidden" name="orderId" value={o.id} />
          <input type="hidden" name="step" value="verify" />
          <span>
            Entered: <LabValue o={o} /> {o.resultedBy && <span className="text-xs text-zinc-500">by {o.resultedBy.fullName}</span>}
          </span>
          <button disabled={pending} className={`${buttonClass} ${small}`}>
            Verify and release
          </button>
        </form>
      )}
    </li>
  );
}

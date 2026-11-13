"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { labStep, markLabUrgent, type FormState } from "@/app/actions";
import { isCritical, LAB_STATUS, LabValue, rangeText } from "@/components/lab-result";
import { Alert, Badge, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { LabOrder, LabWorkOrder } from "@/lib/api";

const small = "px-3 py-1 text-xs";

/** Why a sample can't be used (the API's list; shown in the reject form). */
const REJECT_REASONS: [string, string][] = [
  ["HAEMOLYSED", "Haemolysed"],
  ["CLOTTED", "Clotted"],
  ["INSUFFICIENT", "Too little sample"],
  ["WRONG_CONTAINER", "Wrong tube or container"],
  ["LABEL", "Unlabelled or wrongly labelled"],
  ["CONTAMINATED", "Contaminated"],
  ["DELAYED", "Too old when it reached the lab"],
  ["OTHER", "Other (say what)"],
];

/**
 * The inputs for a result: one per panel component (blank = not run), a choice of answers, a
 * number with its unit and default range, or free text; plus a comment. Used to enter, correct and
 * amend results.
 */
function ResultFields({ o, defaults, restore }: { o: LabOrder; defaults?: boolean; restore?: Record<string, string> }) {
  const t = o.labTest;
  const range = rangeText(t);
  const numeric = !t.resultOptions.length && range !== null;
  // What was typed (after a refused save), else the current result when correcting it.
  const keep = (v: string | null | undefined, name: string) => restore?.[name] ?? (defaults ? (v ?? "") : "");
  return (
    <>
      {t.components?.length ? (
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {t.components.map((c) => {
            const current = keep(o.values?.find((v) => v.componentId === c.id)?.value, `c_${c.id}`);
            const ref = rangeText(c);
            return (
              <label key={c.id} className="block text-sm">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  {ref && <span className="text-xs text-slate-500">{ref}</span>}
                </span>
                {c.resultOptions.length ? (
                  <select name={`c_${c.id}`} defaultValue={current} className={`${inputClass} mt-1`}>
                    <option value="">—</option>
                    {c.resultOptions.map((opt) => (
                      <option key={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input name={`c_${c.id}`} inputMode={ref ? "decimal" : "text"} defaultValue={current} className={`${inputClass} mt-1`} />
                )}
              </label>
            );
          })}
        </div>
      ) : t.resultOptions.length ? (
        <select name="value" required defaultValue={keep(o.resultValue, "value")} aria-label="Result" className={`${inputClass} w-48`}>
          <option value="" disabled>
            Choose result
          </option>
          {t.resultOptions.map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      ) : numeric ? (
        <label className="flex items-center gap-1 text-sm">
          <input name="value" required inputMode="decimal" defaultValue={keep(o.resultValue, "value")} aria-label="Result" className={`${inputClass} w-28`} />
          <span className="text-xs text-slate-500">
            {t.unit} (ref {range}; by sex and age where set)
          </span>
        </label>
      ) : (
        <textarea name="value" required rows={2} defaultValue={keep(o.resultValue, "value")} aria-label="Result" className={`${inputClass} min-w-64 flex-1`} />
      )}
      <input name="note" placeholder="Comment (optional)" defaultValue={keep(o.resultNote, "note")} aria-label="Comment" className={`${inputClass} w-56`} />
    </>
  );
}

/** The sample can't be used: record why; the order goes back to "sample needed". */
function RejectSample({ o }: { o: LabOrder }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("HAEMOLYSED");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
        Sample not usable? Reject it
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm dark:border-red-900/60 dark:bg-red-950/30">
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="step" value="reject" />
      {state.error && (
        <div className="w-full">
          <Alert>{state.error}</Alert>
        </div>
      )}
      <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why the sample can't be used" className={`${inputClass} w-auto`}>
        {REJECT_REASONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input name="note" required={reason === "OTHER"} placeholder={reason === "OTHER" ? "What was wrong (required)" : "Note (optional)"} aria-label="Note" className={`${inputClass} w-56`} />
      <button disabled={pending} className={`${buttonClass} bg-red-700 hover:bg-red-800 ${small}`}>
        {pending ? "Saving…" : "Reject sample"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} ${small}`}>
        Keep it
      </button>
      <p className="w-full text-xs text-slate-500">The test goes back to &ldquo;sample needed&rdquo;; the patient gives a new sample without paying again.</p>
    </form>
  );
}

/** "Critical result: phone the doctor" with where to write who was told. */
function CriticalCall({ required }: { required: boolean }) {
  return (
    <div role="alert" className="w-full space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden className="size-4" />
        Critical result: phone the doctor now, before releasing it.
      </p>
      <input
        name="notified"
        required={required}
        minLength={3}
        placeholder="Who was told, and how (e.g. Dr. Dawit, by phone)"
        aria-label="Who was told of the critical result"
        className={`${inputClass} w-full`}
      />
    </div>
  );
}

/**
 * The turnaround clock, from the sample: "12 of 60 min", or "Overdue 15 min" once past the target.
 * Before the sample there is no clock (the patient may still be at the cashier).
 */
function Clock({ minutes, target }: { minutes: number; target: number }) {
  if (minutes > target) return <Badge tone="danger">Overdue {minutes - target} min</Badge>;
  return (
    <span className={minutes >= target * 0.75 ? "font-medium text-amber-700 dark:text-amber-400" : ""} title="Minutes since the sample, of the target">
      {minutes} of {target} min
    </span>
  );
}

/** Moves a test to the top of the bench with the urgent target (the doctor phoned, the patient got worse). */
function MakeUrgent({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => setError((await markLabUrgent(id)).error))}
      title={error}
      className="text-xs text-slate-500 hover:text-red-700 hover:underline"
    >
      {error ? "Couldn't mark urgent" : "Mark urgent"}
    </button>
  );
}

export function BenchRow({ o, prepayment, sampleMinutes }: { o: LabWorkOrder; prepayment: boolean; /** Minutes since the sample was taken. */ sampleMinutes?: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const t = o.labTest;
  const unpaid = prepayment && o.status === "ORDERED" && !o.paid;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          {o.urgent && (
            <span className="mr-1.5 rounded bg-red-700 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase dark:bg-red-600">Urgent</span>
          )}
          <span className="font-medium">{t.name}</span>
          {t.loincCode && <span className="ml-1 font-mono text-xs text-slate-500">LOINC {t.loincCode}</span>}
          {o.sampleId && <span className="ml-2 font-mono text-xs">· {o.sampleId}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {!o.urgent && <MakeUrgent id={o.id} />}
          {sampleMinutes != null && o.targetMinutes != null && <Clock minutes={sampleMinutes} target={o.targetMinutes} />}
          {unpaid && <Badge tone="danger">Not paid</Badge>}
          {o.status === "ORDERED" && o.rejectReason && <Badge tone="warning">New sample needed</Badge>}
          {o.critical && o.status === "RESULTED" && <Badge tone="danger">Critical</Badge>}
          <Badge tone={o.status === "VERIFIED" ? "success" : o.status === "RESULTED" ? "info" : o.status === "SAMPLE_COLLECTED" ? "brand" : "neutral"} dot>
            {LAB_STATUS[o.status]}
          </Badge>
        </span>
      </div>
      {state.error && <Alert>{state.error}</Alert>}

      {o.status === "ORDERED" && o.rejectReason && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          The last sample was rejected ({o.rejectReason}). Take a new sample.
        </p>
      )}
      {o.status === "ORDERED" &&
        (unpaid ? (
          <p className="text-sm text-slate-500">Send the patient to the cashier before taking the sample.</p>
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
          <ResultFields o={o} defaults />
          <button disabled={pending} className={`${o.status === "RESULTED" ? secondaryButtonClass : buttonClass} ${small}`}>
            {o.status === "RESULTED" ? "Correct result" : "Save result"}
          </button>
        </form>
      )}

      {o.status === "RESULTED" && (
        <form action={action} className="flex flex-wrap items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
          <input type="hidden" name="orderId" value={o.id} />
          <input type="hidden" name="step" value="verify" />
          <span>
            Entered: <LabValue o={o} />
            {o.rangeText && <span className="text-xs text-slate-500"> (ref {o.rangeText})</span>}{" "}
            {o.resultedBy && <span className="text-xs text-slate-500">by {o.resultedBy.fullName}</span>}
          </span>
          {o.critical && <CriticalCall required />}
          <button disabled={pending} className={`${buttonClass} ${small}`}>
            Verify and release
          </button>
        </form>
      )}

      {(o.status === "SAMPLE_COLLECTED" || o.status === "RESULTED") && <RejectSample o={o} />}
    </li>
  );
}

/**
 * Corrects a released result: the old one is kept, the reason recorded, the report marked
 * "Amended" and the doctor alerted.
 */
export function AmendResult({ o }: { o: LabOrder }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
        Amend
      </button>
    );
  }
  return (
    <form action={action} className="mt-2 flex w-full flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="step" value="amend" />
      {state.error && (
        <div className="w-full">
          <Alert>{state.error}</Alert>
        </div>
      )}
      {state.ok && !pending ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">Amended; the doctor is alerted.</p>
      ) : (
        <>
          <p className="w-full text-xs text-slate-600 dark:text-slate-300">
            Corrected result for {o.labTest.name}. The released result is kept with your reason, the report shows &ldquo;Amended&rdquo;, and the doctor is
            alerted.
          </p>
          <ResultFields o={o} restore={state.values} />
          <input name="reason" required minLength={5} defaultValue={state.values?.reason} placeholder="What was wrong with the released result" aria-label="Reason for the amendment" className={`${inputClass} w-full`} />
          {(state.error?.includes("critical") || isCritical(o.resultFlag)) && <CriticalCall required={false} />}
          <button disabled={pending} className={`${buttonClass} ${small}`}>
            {pending ? "Saving…" : "Release corrected result"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} ${small}`}>
            Cancel
          </button>
        </>
      )}
    </form>
  );
}

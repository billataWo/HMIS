"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/app/actions";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { LabQcControl, LabQcPage } from "@/lib/api";
import { addQcControl, recordQcAction, recordQcRun, setQcControlActive } from "../qc-actions";

const small = "px-3 py-1 text-xs";

/** Records one run of a control: a number for a measured level, the kit's answer for a kit control. */
export function RunForm({ c, unit, options }: { c: LabQcControl; unit: string | null; options: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordQcRun, {});
  const answers = c.expected ? [...new Set([c.expected, ...options])] : [];
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="controlId" value={c.id} />
      {c.expected ? (
        <select name="value" required defaultValue="" aria-label={`${c.name} result`} className={`${inputClass} w-44`}>
          <option value="" disabled>
            Control result
          </option>
          {answers.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      ) : (
        <span className="flex items-center gap-1">
          <input name="value" required inputMode="decimal" aria-label={`${c.name} result`} placeholder="Result" className={`${inputClass} w-28`} />
          {unit && <span className="text-xs text-slate-500">{unit}</span>}
        </span>
      )}
      <input name="note" placeholder="Note (optional)" aria-label="Note" className={`${inputClass} w-48`} />
      <button disabled={pending} className={`${buttonClass} ${small}`}>
        {pending ? "Saving…" : "Record run"}
      </button>
      {state.error && (
        <div className="w-full">
          <Alert>{state.error}</Alert>
        </div>
      )}
    </form>
  );
}

/** After a failed run: what was done about it (then the control is run again). */
export function ActionForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordQcAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="runId" value={runId} />
      <input
        name="action"
        required
        minLength={3}
        placeholder="What was done (new reagent, recalibrated, fresh control…)"
        aria-label="Corrective action"
        className={`${inputClass} min-w-64 flex-1`}
      />
      <button disabled={pending} className={`${secondaryButtonClass} ${small}`}>
        Save
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

/** Takes a control out of use (a new lot replaced it), or back in. */
export function RetireControl({ c }: { c: LabQcControl }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setQcControlActive(c.id, !c.active))}
      className="text-xs text-slate-500 hover:text-slate-900 hover:underline dark:hover:text-white"
    >
      {c.active ? "Stop using" : "Use again"}
    </button>
  );
}

/** A new control: which test, its name and lot, and either a mean and SD or the answer it must give. */
export function AddControl({ tests }: { tests: LabQcPage["allTests"] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addQcControl, {});
  const [kind, setKind] = useState<"measured" | "kit">("measured");
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};
  return (
    <form key={state.ok ? "done" : "form"} action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">Control added.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Test" error={err.labTestId}>
          <select name="labTestId" required defaultValue={v.labTestId ?? ""} className={inputClass}>
            <option value="" disabled>
              Choose…
            </option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" error={err.name}>
          <Input name="name" required minLength={2} defaultValue={v.name} placeholder="Level 1 (normal)" />
        </Field>
        <Field label="Lot (optional)" error={err.lot}>
          <Input name="lot" defaultValue={v.lot} />
        </Field>
        <Field label="Expires (optional)" error={err.expiresAt}>
          <Input name="expiresAt" type="date" defaultValue={v.expiresAt} />
        </Field>
      </div>
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="sr-only">Kind of control</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="kind" value="measured" checked={kind === "measured"} onChange={() => setKind("measured")} /> Measured (mean and SD)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="kind" value="kit" checked={kind === "kit"} onChange={() => setKind("kit")} /> Kit control (positive / negative)
        </label>
      </fieldset>
      {kind === "measured" ? (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="Target mean" error={err.mean}>
            <Input name="mean" required inputMode="decimal" defaultValue={v.mean} />
          </Field>
          <Field label="SD" error={err.sd} hint="From the insert, or your lab's own">
            <Input name="sd" required inputMode="decimal" defaultValue={v.sd} />
          </Field>
        </div>
      ) : (
        <div className="max-w-xs">
          <Field label="It must give" error={err.expected} hint="e.g. Non-reactive for a negative control">
            <Input name="expected" required defaultValue={v.expected} />
          </Field>
        </div>
      )}
      <button disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "Add control"}
      </button>
    </form>
  );
}

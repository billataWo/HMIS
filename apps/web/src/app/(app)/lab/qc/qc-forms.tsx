"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { LabQcControl, LabQcPage } from "@/lib/api";
import { addQcControl, recordQcAction, recordQcRun, setQcControlActive } from "../qc-actions";

const small = "px-3 py-1 text-xs";

/** Records one run of a control: a number for a measured level, the kit's answer for a kit control. */
export function RunForm({ c, unit, options }: { c: LabQcControl; unit: string | null; options: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordQcRun, {});
  const answers = c.expected ? [...new Set([c.expected, ...options])] : [];
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="controlId" value={c.id} />
      {c.expected ? (
        <select name="value" required defaultValue="" aria-label={t("{name} result", { name: c.name })} className={`${inputClass} w-44`}>
          <option value="" disabled>
            {t("Control result")}
          </option>
          {answers.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      ) : (
        <span className="flex items-center gap-1">
          <input name="value" required inputMode="decimal" aria-label={t("{name} result", { name: c.name })} placeholder={t("Result")} className={`${inputClass} w-28`} />
          {unit && <span className="text-xs text-slate-500">{unit}</span>}
        </span>
      )}
      <input name="note" placeholder={t("Note (optional)")} aria-label={t("Note")} className={`${inputClass} w-48`} />
      <button disabled={pending} className={`${buttonClass} ${small}`}>
        {pending ? t("Saving…") : t("Record run")}
      </button>
      {state.error && (
        <div className="w-full">
          <Alert>{t(state.error)}</Alert>
        </div>
      )}
    </form>
  );
}

/** After a failed run: what was done about it (then the control is run again). */
export function ActionForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordQcAction, {});
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="runId" value={runId} />
      <input
        name="action"
        required
        minLength={3}
        placeholder={t("What was done (new reagent, recalibrated, fresh control…)")}
        aria-label={t("Corrective action")}
        className={`${inputClass} min-w-64 flex-1`}
      />
      <button disabled={pending} className={`${secondaryButtonClass} ${small}`}>
        {t("Save")}
      </button>
      {state.error && <span className="text-xs text-red-700">{t(state.error)}</span>}
    </form>
  );
}

/** Takes a control out of use (a new lot replaced it), or back in. */
export function RetireControl({ c }: { c: LabQcControl }) {
  const [pending, start] = useTransition();
  const t = useT();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setQcControlActive(c.id, !c.active))}
      className="text-xs text-slate-500 hover:text-slate-900 hover:underline dark:hover:text-white"
    >
      {t(c.active ? "Stop using" : "Use again")}
    </button>
  );
}

/** A new control: which test, its name and lot, and either a mean and SD or the answer it must give. */
export function AddControl({ tests }: { tests: LabQcPage["allTests"] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addQcControl, {});
  const [kind, setKind] = useState<"measured" | "kit">("measured");
  const v = state.values ?? {};
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  return (
    <form key={state.ok ? "done" : "form"} action={action} className="space-y-4">
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Control added.")}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("Test")} error={err.labTestId}>
          <select name="labTestId" required defaultValue={v.labTestId ?? ""} className={inputClass}>
            <option value="" disabled>
              {t("Choose…")}
            </option>
            {tests.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Name")} error={err.name}>
          <Input name="name" required minLength={2} defaultValue={v.name} placeholder={t("Level 1 (normal)")} />
        </Field>
        <Field label={t("Lot (optional)")} error={err.lot}>
          <Input name="lot" defaultValue={v.lot} />
        </Field>
        <Field label={t("Expires (optional)")} error={err.expiresAt}>
          <Input name="expiresAt" type="date" defaultValue={v.expiresAt} />
        </Field>
      </div>
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="sr-only">{t("Kind of control")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="kind" value="measured" checked={kind === "measured"} onChange={() => setKind("measured")} /> {t("Measured (mean and SD)")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="kind" value="kit" checked={kind === "kit"} onChange={() => setKind("kit")} /> {t("Kit control (positive / negative)")}
        </label>
      </fieldset>
      {kind === "measured" ? (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label={t("Target mean")} error={err.mean}>
            <Input name="mean" required inputMode="decimal" defaultValue={v.mean} />
          </Field>
          <Field label="SD" error={err.sd} hint={t("From the insert, or your lab's own")}>
            <Input name="sd" required inputMode="decimal" defaultValue={v.sd} />
          </Field>
        </div>
      ) : (
        <div className="max-w-xs">
          <Field label={t("It must give")} error={err.expected} hint={t("e.g. Non-reactive for a negative control")}>
            <Input name="expected" required defaultValue={v.expected} />
          </Field>
        </div>
      )}
      <button disabled={pending} className={buttonClass}>
        {pending ? t("Adding…") : t("Add control")}
      </button>
    </form>
  );
}

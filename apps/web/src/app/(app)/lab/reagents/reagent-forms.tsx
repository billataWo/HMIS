"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { LabReagentLot, LabReagentRow } from "@/lib/api";
import { addReagent, adjustReagent, receiveReagent, setReagentUses, updateReagent } from "../qc-actions";

const small = "px-3 py-1 text-xs";

function Saved({ state, pending, text = "Saved" }: { state: FormState; pending: boolean; text?: string }) {
  const t = useT();
  if (state.error) return <span className="text-xs text-red-700 dark:text-red-400">{t(state.error)}</span>;
  if (state.ok && !pending) return <span className="text-xs text-emerald-700 dark:text-emerald-400">{t(text)}</span>;
  return null;
}

/** A delivery: how many, the lot number and its expiry. */
export function Receive({ r }: { r: LabReagentRow }) {
  const [state, action, pending] = useActionState<FormState, FormData>(receiveReagent, {});
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="id" value={r.id} />
      <span className="font-medium">{t("Received")}</span>
      <input name="quantity" type="number" min={1} required placeholder={t("How many")} aria-label={t("How many received")} className={`${inputClass} w-24`} />
      <span className="text-xs text-slate-500">{r.unit}</span>
      <input name="lot" placeholder={t("Lot (optional)")} aria-label={t("Lot")} className={`${inputClass} w-32`} />
      <input name="expiresAt" type="date" aria-label={t("Expiry date")} className={`${inputClass} w-40`} />
      <button disabled={pending} className={`${buttonClass} ${small}`}>
        {t("Add to stock")}
      </button>
      <Saved state={state} pending={pending} text="Added" />
    </form>
  );
}

/** A count, damage or expiry for one lot: more (+) or fewer (−), and why. */
export function Adjust({ r, lot, reasons }: { r: LabReagentRow; lot: LabReagentLot; reasons: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(adjustReagent, {});
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-slate-900 hover:underline dark:hover:text-white">
        {t("Adjust")}
      </button>
    );
  }
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="lotId" value={lot.id} />
      <input name="quantity" type="number" required placeholder={t("+5 or −2")} aria-label={t("More (+) or fewer (−)")} className={`${inputClass} w-24`} />
      <select name="reason" defaultValue="COUNT" aria-label={t("Why")} className={`${inputClass} w-auto`}>
        {Object.entries(reasons).map(([k, label]) => (
          <option key={k} value={k}>
            {t(label)}
          </option>
        ))}
      </select>
      <input name="note" placeholder={t("Note")} aria-label={t("Note")} className={`${inputClass} w-40`} />
      <button disabled={pending} className={`${secondaryButtonClass} ${small}`}>
        {t("Save")}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
        {t("Close")}
      </button>
      <Saved state={state} pending={pending} />
    </form>
  );
}

/** Which tests use the reagent, and how many units each test takes. */
export function Uses({ r, tests }: { r: LabReagentRow; tests: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setReagentUses, {});
  const per = new Map(r.uses.map((u) => [u.labTestId, u.perTest]));
  const t = useT();
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={r.id} />
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {tests.map((lt) => (
          <label key={lt.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="test" value={lt.id} defaultChecked={per.has(lt.id)} />
            <span className="min-w-0 flex-1 truncate">{lt.name}</span>
            <input
              name={`per_${lt.id}`}
              type="number"
              min={1}
              defaultValue={per.get(lt.id) ?? 1}
              aria-label={t("{unit} per {test}", { unit: r.unit, test: lt.name })}
              title={t("{unit} per test", { unit: r.unit })}
              className={`${inputClass} w-16 py-1`}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending} className={`${secondaryButtonClass} ${small}`}>
          {t("Save tests")}
        </button>
        <Saved state={state} pending={pending} />
      </div>
    </form>
  );
}

/** The reorder level, and whether the reagent is still used. */
export function Settings({ r }: { r: LabReagentRow }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateReagent, {});
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="id" value={r.id} />
      <label className="flex items-center gap-1 text-xs text-slate-500">
        {t("Reorder at")}
        <input name="reorderLevel" type="number" min={0} defaultValue={r.reorderLevel} aria-label={t("Reorder level")} className={`${inputClass} w-20 py-1`} />
      </label>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" name="active" defaultChecked={r.active} /> {t("in use")}
      </label>
      <button disabled={pending} className={`${secondaryButtonClass} ${small}`}>
        {t("Save")}
      </button>
      <Saved state={state} pending={pending} />
    </form>
  );
}

export function AddReagent() {
  const [state, action, pending] = useActionState<FormState, FormData>(addReagent, {});
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  return (
    <form key={state.ok ? "done" : "form"} action={action} className="space-y-3">
      {state.error && !Object.keys(err).length && <Alert>{t(state.error)}</Alert>}
      {state.ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Reagent added. Receive its stock and tick the tests that use it.")}</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_8rem]">
        <Field label={t("Name")} error={err.name}>
          <Input name="name" required minLength={2} defaultValue={state.values?.name} placeholder={t("HIV 1+2 rapid test kit")} />
        </Field>
        <Field label={t("Counted in")} error={err.unit}>
          <Input name="unit" required defaultValue={state.values?.unit ?? "test"} placeholder={t("test, strip…")} />
        </Field>
        <Field label={t("Reorder at")} error={err.reorderLevel}>
          <Input name="reorderLevel" type="number" min={0} defaultValue={state.values?.reorderLevel ?? "0"} />
        </Field>
      </div>
      <button disabled={pending} className={buttonClass}>
        {pending ? t("Adding…") : t("Add reagent")}
      </button>
    </form>
  );
}

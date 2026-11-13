"use client";

import { useActionState } from "react";
import { saveLabTest, saveService, type FormState } from "@/app/actions";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { CatalogLabTest, CatalogService } from "@/lib/api";

const small = "px-3 py-1 text-xs";

function Status({ state, pending }: { state: FormState; pending: boolean }) {
  if (state.error) return <span className="text-xs text-red-600">{Object.values(state.fieldErrors ?? {})[0] ?? state.error}</span>;
  if (state.ok && !pending) return <span className="text-xs text-emerald-700 dark:text-emerald-400">Saved</span>;
  return null;
}

export function ServiceRow({ s }: { s?: CatalogService }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveService, {});
  return (
    <form action={action} className="grid grid-cols-2 items-center gap-2 py-2 text-sm sm:grid-cols-[6rem_1fr_7rem_9rem_auto_auto]">
      {s ? (
        <>
          <input type="hidden" name="id" value={s.id} />
          <span className="font-mono text-xs">{s.code}</span>
        </>
      ) : (
        <input name="code" required placeholder="CODE" aria-label="Code" className={inputClass} />
      )}
      <input name="name" required defaultValue={s?.name} placeholder="Service name" aria-label="Name" className={inputClass} />
      <input name="price" type="number" min={0} step="0.01" required defaultValue={s ? Number(s.price).toFixed(2) : ""} placeholder="ETB" aria-label="Price" className={inputClass} />
      <select name="kind" defaultValue={s?.kind ?? "CONSULTATION"} aria-label="Kind" className={inputClass} title="Fees are taken at check-in; procedures are recorded during the visit">
        <option value="CONSULTATION">Fee at check-in</option>
        <option value="PROCEDURE">Procedure</option>
      </select>
      {s ? (
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="active" defaultChecked={s.active} /> active
        </label>
      ) : (
        <span />
      )}
      <span className="flex items-center gap-2">
        <button disabled={pending} className={`${s ? secondaryButtonClass : buttonClass} ${small}`}>
          {s ? "Save" : "Add"}
        </button>
        <Status state={state} pending={pending} />
      </span>
    </form>
  );
}

export function LabTestRow({ t }: { t?: CatalogLabTest }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveLabTest, {});
  const num = (x: string | null | undefined) => (x === null || x === undefined ? "" : String(Number(x)));
  return (
    <form action={action} className="space-y-2 py-3 text-sm">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_5rem_5rem_6rem]">
        <input name="name" required defaultValue={t?.name} placeholder="Test name" aria-label="Test name" className={`${inputClass} col-span-2 sm:col-span-1`} />
        <input name="unit" defaultValue={t?.unit ?? ""} placeholder="Unit" aria-label="Unit" className={inputClass} />
        <input name="refLow" type="number" step="any" defaultValue={num(t?.refLow)} placeholder="Low" aria-label="Reference low" className={inputClass} />
        <input name="refHigh" type="number" step="any" defaultValue={num(t?.refHigh)} placeholder="High" aria-label="Reference high" className={inputClass} />
        <input name="price" type="number" min={0} step="0.01" required defaultValue={t ? Number(t.price).toFixed(2) : ""} placeholder="ETB" aria-label="Price" className={inputClass} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="resultOptions"
          defaultValue={t?.resultOptions.join(", ")}
          placeholder="Answer choices, comma-separated (for tests without a numeric range)"
          aria-label="Answer choices"
          className={`${inputClass} w-full min-w-0 flex-1 sm:min-w-64`}
        />
        <input name="loincCode" defaultValue={t?.loincCode ?? ""} placeholder="LOINC" aria-label="LOINC code" className={`${inputClass} w-28`} />
        <label className="flex items-center gap-1 text-xs text-slate-500" title="How long the test should take, from the sample to the released result. The bench warns when it is overdue.">
          <input name="tatMinutes" type="number" min={5} step={1} defaultValue={t?.tatMinutes ?? ""} placeholder="—" aria-label="Target time in minutes" className={`${inputClass} w-20`} />
          min target
        </label>
        <PanelComponents t={t} />
        {t && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="active" defaultChecked={t.active} /> active
          </label>
        )}
        <button disabled={pending} className={`${t ? secondaryButtonClass : buttonClass} ${small}`}>
          {t ? "Save" : "Add test"}
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

/** A panel's components as editable lines; hidden behind a toggle so simple tests stay simple. */
function PanelComponents({ t }: { t?: CatalogLabTest }) {
  const original = (t?.components ?? [])
    .map((c) =>
      [c.name, c.unit ?? "", c.refLow !== null || c.refHigh !== null ? `${c.refLow === null ? "" : Number(c.refLow)}-${c.refHigh === null ? "" : Number(c.refHigh)}` : "", c.resultOptions.join("/")]
        .join(" | ")
        .replace(/( \| )+$/, ""),
    )
    .join("\n");
  return (
    <details className="w-full text-xs" open={!!original}>
      <summary className="text-brand-700 dark:text-brand-400">{original ? `Panel: ${t?.components?.length} components` : "Make this a panel (CBC, urinalysis…)"}</summary>
      <input type="hidden" name="componentsOriginal" value={original} />
      <textarea
        name="components"
        defaultValue={original}
        rows={Math.max(3, (t?.components?.length ?? 0) + 1)}
        placeholder={"One per line: name | unit | low-high | answers\nWBC | ×10³/µL | 4-11\nNitrite | | | Negative/Positive"}
        className={`${inputClass} mt-1 font-mono text-xs`}
      />
      <span className="mt-1 block text-slate-500">Each component has its own unit and range, or its own answers. They can&apos;t be changed after results are entered.</span>
    </details>
  );
}

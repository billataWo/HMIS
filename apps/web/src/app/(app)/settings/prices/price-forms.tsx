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
    <form action={action} className="grid grid-cols-[6rem_1fr_7rem_auto_auto] items-center gap-2 py-2 text-sm">
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
          className={`${inputClass} min-w-64 flex-1`}
        />
        <input name="loincCode" defaultValue={t?.loincCode ?? ""} placeholder="LOINC" aria-label="LOINC code" className={`${inputClass} w-28`} />
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

"use client";

import { useActionState } from "react";
import { saveLabTest, saveService, type FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { CatalogLabTest, CatalogService } from "@/lib/api";
import { SPECIMENS } from "@/lib/specimens";

const small = "px-3 py-1 text-xs";

function Status({ state, pending }: { state: FormState; pending: boolean }) {
  const t = useT();
  if (state.error) return <span className="text-xs text-red-600">{t(Object.values(state.fieldErrors ?? {})[0] ?? state.error)}</span>;
  if (state.ok && !pending) return <span className="text-xs text-emerald-700 dark:text-emerald-400">{t("Saved")}</span>;
  return null;
}

export function ServiceRow({ s }: { s?: CatalogService }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveService, {});
  const t = useT();
  return (
    <form action={action} className="grid grid-cols-2 items-center gap-2 py-2 text-sm sm:grid-cols-[6rem_1fr_7rem_9rem_auto_auto]">
      {s ? (
        <>
          <input type="hidden" name="id" value={s.id} />
          <span className="font-mono text-xs">{s.code}</span>
        </>
      ) : (
        <input name="code" required placeholder={t("CODE")} aria-label={t("Code")} className={inputClass} />
      )}
      <input name="name" required defaultValue={s?.name} placeholder={t("Service name")} aria-label={t("Name")} className={inputClass} />
      <input name="price" type="number" min={0} step="0.01" required defaultValue={s ? Number(s.price).toFixed(2) : ""} placeholder={t("ETB")} aria-label={t("Price")} className={inputClass} />
      <select name="kind" defaultValue={s?.kind ?? "CONSULTATION"} aria-label={t("Kind")} className={inputClass} title={t("Fees are taken at check-in; procedures are recorded during the visit")}>
        <option value="CONSULTATION">{t("Fee at check-in")}</option>
        <option value="PROCEDURE">{t("Procedure")}</option>
      </select>
      {s ? (
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="active" defaultChecked={s.active} /> {t("active")}
        </label>
      ) : (
        <span />
      )}
      <span className="flex items-center gap-2">
        <button disabled={pending} className={`${s ? secondaryButtonClass : buttonClass} ${small}`}>
          {t(s ? "Save" : "Add")}
        </button>
        <Status state={state} pending={pending} />
      </span>
    </form>
  );
}

export function LabTestRow({ test }: { test?: CatalogLabTest }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveLabTest, {});
  const t = useT();
  const num = (x: string | null | undefined) => (x === null || x === undefined ? "" : String(Number(x)));
  return (
    <form action={action} className="space-y-2 py-3 text-sm">
      {test && <input type="hidden" name="id" value={test.id} />}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_5rem_5rem_6rem]">
        <input name="name" required defaultValue={test?.name} placeholder={t("Test name")} aria-label={t("Test name")} className={`${inputClass} col-span-2 sm:col-span-1`} />
        <input name="unit" defaultValue={test?.unit ?? ""} placeholder={t("Unit")} aria-label={t("Unit")} className={inputClass} />
        <input name="refLow" type="number" step="any" defaultValue={num(test?.refLow)} placeholder={t("Low")} aria-label={t("Reference low")} className={inputClass} />
        <input name="refHigh" type="number" step="any" defaultValue={num(test?.refHigh)} placeholder={t("High")} aria-label={t("Reference high")} className={inputClass} />
        <input name="price" type="number" min={0} step="0.01" required defaultValue={test ? Number(test.price).toFixed(2) : ""} placeholder={t("ETB")} aria-label={t("Price")} className={inputClass} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="resultOptions"
          defaultValue={test?.resultOptions.join(", ")}
          placeholder={t("Answer choices, comma-separated (for tests without a numeric range)")}
          aria-label={t("Answer choices")}
          className={`${inputClass} w-full min-w-0 flex-1 sm:min-w-64`}
        />
        <input name="loincCode" defaultValue={test?.loincCode ?? ""} placeholder="LOINC" aria-label={t("LOINC code")} className={`${inputClass} w-28`} />
      </div>
      {/* How the sample is handled: its tube, whether it goes to a reference lab, and how long it should take. */}
      <div className="flex flex-wrap items-center gap-2">
        <select name="specimen" defaultValue={test?.specimen ?? ""} aria-label={t("Specimen")} title={t("What the test is done on; tests with the same specimen share a tube")} className={`${inputClass} w-auto`}>
          <option value="">{t("Specimen…")}</option>
          {Object.entries(SPECIMENS).map(([code, s]) => (
            <option key={code} value={code}>
              {t(s.label)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs" title={t("Not done here: the sample goes to a reference lab")}>
          <input type="checkbox" name="sendOut" defaultChecked={test?.sendOut} /> {t("sent out")}
        </label>
        <input
          name="referenceLab"
          defaultValue={test?.referenceLab ?? ""}
          placeholder={t("Usual reference lab")}
          aria-label={t("Usual reference lab")}
          title={t("Where this test is usually sent (suggested when sending)")}
          className={`${inputClass} w-44`}
        />
        <label className="flex items-center gap-1 text-xs text-slate-500" title={t("How long the test should take, from the sample to the released result. The bench warns when it is overdue.")}>
          <input name="tatMinutes" type="number" min={5} step={1} defaultValue={test?.tatMinutes ?? ""} placeholder="—" aria-label={t("Target time in minutes")} className={`${inputClass} w-20`} />
          {t("min target")}
        </label>
        <PanelComponents test={test} />
        {test && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="active" defaultChecked={test.active} /> {t("active")}
          </label>
        )}
        <button disabled={pending} className={`${test ? secondaryButtonClass : buttonClass} ${small}`}>
          {t(test ? "Save" : "Add test")}
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

/** A panel's components as editable lines; hidden behind a toggle so simple tests stay simple. */
function PanelComponents({ test }: { test?: CatalogLabTest }) {
  const t = useT();
  const original = (test?.components ?? [])
    .map((c) =>
      [c.name, c.unit ?? "", c.refLow !== null || c.refHigh !== null ? `${c.refLow === null ? "" : Number(c.refLow)}-${c.refHigh === null ? "" : Number(c.refHigh)}` : "", c.resultOptions.join("/")]
        .join(" | ")
        .replace(/( \| )+$/, ""),
    )
    .join("\n");
  return (
    <details className="w-full text-xs" open={!!original}>
      <summary className="text-brand-700 dark:text-brand-400">{original ? t("Panel: {n} components", { n: test?.components?.length ?? 0 }) : t("Make this a panel (CBC, urinalysis…)")}</summary>
      <input type="hidden" name="componentsOriginal" value={original} />
      <textarea
        name="components"
        defaultValue={original}
        rows={Math.max(3, (test?.components?.length ?? 0) + 1)}
        placeholder={`${t("One per line: name | unit | low-high | answers")}\nWBC | ×10³/µL | 4-11\nNitrite | | | Negative/Positive`}
        className={`${inputClass} mt-1 font-mono text-xs`}
      />
      <span className="mt-1 block text-slate-500">{t("Each component has its own unit and range, or its own answers. They can't be changed after results are entered.")}</span>
    </details>
  );
}

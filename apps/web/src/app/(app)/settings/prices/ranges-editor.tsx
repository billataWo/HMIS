"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { saveLabRanges, applyRecommendedLabRanges } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { CatalogLabTest, LabRange } from "@/lib/api";

type Unit = "d" | "mo" | "y";
const DAYS: Record<Unit, number> = { d: 1, mo: 30, y: 365 };
type Row = {
  componentId: string;
  sex: "" | "MALE" | "FEMALE";
  from: string;
  fromUnit: Unit;
  to: string;
  toUnit: Unit;
  refLow: string;
  refHigh: string;
  critLow: string;
  critHigh: string;
};

const text = (x: string | null | undefined) => (x === null || x === undefined ? "" : String(Number(x)));
const num = (s: string) => (s.trim() === "" ? null : Number(s));
/** Days as the plainest unit: 5475 → 15 y, 180 → 6 mo, 28 → 28 d. */
function fromDays(d: number | null): [string, Unit] {
  if (d === null) return ["", "y"];
  if (d === 0) return ["0", "y"];
  if (d % 365 === 0) return [String(d / 365), "y"];
  if (d % 30 === 0) return [String(d / 30), "mo"];
  return [String(d), "d"];
}
const toRow = (r: LabRange, componentId: string): Row => {
  const [from, fromUnit] = fromDays(r.ageFromDays);
  const [to, toUnit] = fromDays(r.ageToDays);
  return { componentId, sex: r.sex ?? "", from, fromUnit, to, toUnit, refLow: text(r.refLow), refHigh: text(r.refHigh), critLow: text(r.critLow), critHigh: text(r.critHigh) };
};

/**
 * A test's critical (panic) limits and its ranges for men, women and age groups. The test's own
 * range (set above) applies to everyone else; a range that leaves a limit empty takes it from there.
 */
export function RangesEditor({ test }: { test: CatalogLabTest }) {
  const t = useT();
  const parts = test.components ?? [];
  const numericParts = parts.filter((c) => !c.resultOptions.length);
  const isPanel = parts.length > 0;
  const initialRows = [
    ...(test.ranges ?? []).map((r) => toRow(r, "")),
    ...parts.flatMap((c) => (c.ranges ?? []).map((r) => toRow(r, c.id))),
  ];
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [crit, setCrit] = useState({ low: text(test.critLow), high: text(test.critHigh) });
  const [compCrit, setCompCrit] = useState<Record<string, { low: string; high: string }>>(
    Object.fromEntries(parts.map((c) => [c.id, { low: text(c.critLow), high: text(c.critHigh) }])),
  );
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const count = initialRows.length + (test.critLow || test.critHigh ? 1 : 0) + parts.filter((c) => c.critLow || c.critHigh).length;

  if (test.resultOptions.length && !isPanel) return null; // answers (positive/negative…) have no numeric range
  const update = (i: number, patch: Partial<Row>) => (setSaved(false), setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))));
  const save = () =>
    start(async () => {
      setError(undefined);
      const res = await saveLabRanges(test.id, {
        critLow: isPanel ? null : num(crit.low),
        critHigh: isPanel ? null : num(crit.high),
        components: numericParts.map((c) => ({ id: c.id, critLow: num(compCrit[c.id]?.low ?? ""), critHigh: num(compCrit[c.id]?.high ?? "") })),
        ranges: rows.map((r) => ({
          componentId: r.componentId || null,
          sex: r.sex || null,
          ageFromDays: (num(r.from) ?? 0) * DAYS[r.fromUnit],
          ageToDays: r.to.trim() === "" ? null : Number(r.to) * DAYS[r.toUnit],
          refLow: num(r.refLow),
          refHigh: num(r.refHigh),
          critLow: num(r.critLow),
          critHigh: num(r.critHigh),
        })),
      });
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  const small = `${inputClass} px-2 py-1 text-xs`;
  const age = (value: string, unit: Unit, onValue: (v: string) => void, onUnit: (u: Unit) => void, label: string, placeholder: string) => (
    <span className="flex gap-1">
      <input value={value} onChange={(e) => onValue(e.target.value)} type="number" min={0} placeholder={placeholder} aria-label={label} className={`${small} w-16`} />
      <select value={unit} onChange={(e) => onUnit(e.target.value as Unit)} aria-label={t("{label} unit", { label })} className={`${small} w-auto`}>
        <option value="d">{t("days")}</option>
        <option value="mo">{t("months")}</option>
        <option value="y">{t("years")}</option>
      </select>
    </span>
  );

  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-brand-700 dark:text-brand-400">{t("Ranges and critical limits")}{count ? ` (${count})` : ""}</summary>
      <div className="mt-2 space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-slate-500">
          {t(
            "Critical limits: a result beyond them must be phoned to the doctor before it is released. Ranges for men, women or age groups override the normal range above for those patients; the closest fit wins, and an empty limit is taken from above.",
          )}
        </p>
        {!isPanel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t("Critical below")}</span>
            <input value={crit.low} onChange={(e) => (setSaved(false), setCrit((c) => ({ ...c, low: e.target.value })))} type="number" step="any" aria-label={t("{name} critical low", { name: test.name })} className={`${small} w-20`} />
            <span className="font-medium">{t("or above")}</span>
            <input value={crit.high} onChange={(e) => (setSaved(false), setCrit((c) => ({ ...c, high: e.target.value })))} type="number" step="any" aria-label={t("{name} critical high", { name: test.name })} className={`${small} w-20`} />
            <span className="text-slate-500">{test.unit}</span>
          </div>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {numericParts.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="w-24 font-medium">{c.name}</span>
                <span>{t("critical below")}</span>
                <input
                  value={compCrit[c.id]?.low ?? ""}
                  onChange={(e) => (setSaved(false), setCompCrit((m) => ({ ...m, [c.id]: { ...m[c.id], low: e.target.value } })))}
                  type="number"
                  step="any"
                  aria-label={t("{name} critical low", { name: c.name })}
                  className={`${small} w-16`}
                />
                <span>{t("above")}</span>
                <input
                  value={compCrit[c.id]?.high ?? ""}
                  onChange={(e) => (setSaved(false), setCompCrit((m) => ({ ...m, [c.id]: { ...m[c.id], high: e.target.value } })))}
                  type="number"
                  step="any"
                  aria-label={t("{name} critical high", { name: c.name })}
                  className={`${small} w-16`}
                />
              </div>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-slate-500">
                <tr>
                  {isPanel && <th className="py-1 pr-2 font-medium">{t("Component")}</th>}
                  <th className="py-1 pr-2 font-medium">{t("For")}</th>
                  <th className="py-1 pr-2 font-medium">{t("Age from")}</th>
                  <th className="py-1 pr-2 font-medium">{t("to (not incl.)")}</th>
                  <th className="py-1 pr-2 font-medium">{t("Normal low–high")}</th>
                  <th className="py-1 pr-2 font-medium">{t("Critical below / above")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    {isPanel && (
                      <td className="py-1 pr-2">
                        <select value={r.componentId} onChange={(e) => update(i, { componentId: e.target.value })} aria-label={t("Component")} className={`${small} w-auto`}>
                          {numericParts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="py-1 pr-2">
                      <select value={r.sex} onChange={(e) => update(i, { sex: e.target.value as Row["sex"] })} aria-label={t("For")} className={`${small} w-auto`}>
                        <option value="">{t("Everyone")}</option>
                        <option value="MALE">{t("Males")}</option>
                        <option value="FEMALE">{t("Females")}</option>
                      </select>
                    </td>
                    <td className="py-1 pr-2">{age(r.from, r.fromUnit, (v) => update(i, { from: v }), (u) => update(i, { fromUnit: u }), t("Age from"), "0")}</td>
                    <td className="py-1 pr-2">{age(r.to, r.toUnit, (v) => update(i, { to: v }), (u) => update(i, { toUnit: u }), t("Age to"), t("any"))}</td>
                    <td className="py-1 pr-2">
                      <span className="flex gap-1">
                        <input value={r.refLow} onChange={(e) => update(i, { refLow: e.target.value })} type="number" step="any" aria-label={t("Normal low")} className={`${small} w-20`} />
                        <input value={r.refHigh} onChange={(e) => update(i, { refHigh: e.target.value })} type="number" step="any" aria-label={t("Normal high")} className={`${small} w-20`} />
                      </span>
                    </td>
                    <td className="py-1 pr-2">
                      <span className="flex gap-1">
                        <input value={r.critLow} onChange={(e) => update(i, { critLow: e.target.value })} type="number" step="any" placeholder="—" aria-label={t("Critical low")} className={`${small} w-20`} />
                        <input value={r.critHigh} onChange={(e) => update(i, { critHigh: e.target.value })} type="number" step="any" placeholder="—" aria-label={t("Critical high")} className={`${small} w-20`} />
                      </span>
                    </td>
                    <td className="py-1 text-right">
                      <button type="button" onClick={() => (setSaved(false), setRows((rs) => rs.filter((_, j) => j !== i)))} aria-label={t("Remove range")} className="rounded p-1 text-slate-500 hover:text-red-700">
                        <X aria-hidden className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <Alert>{t(error)}</Alert>}
        {saved && !pending && <p className="text-emerald-700 dark:text-emerald-400">{t("Saved. New results use these; earlier ones keep the range they were judged by.")}</p>}
        <div className="flex flex-wrap gap-2">
          {(!isPanel || numericParts.length > 0) && (
            <button
              type="button"
              onClick={() =>
                setRows((rs) => [...rs, { componentId: numericParts[0]?.id ?? "", sex: "", from: "", fromUnit: "y", to: "", toUnit: "y", refLow: "", refHigh: "", critLow: "", critHigh: "" }])
              }
              className={`${secondaryButtonClass} px-2 py-1 text-xs`}
            >
              <Plus aria-hidden className="size-3.5" />
              {t("Add a range")}
            </button>
          )}
          <button type="button" disabled={pending} onClick={save} className={`${buttonClass} px-3 py-1 text-xs`}>
            {pending ? t("Saving…") : t("Save ranges")}
          </button>
        </div>
      </div>
    </details>
  );
}

/** For clinics set up before ranges existed: fills in the recommended ones where a test has none. */
export function RecommendedRanges() {
  const [result, setResult] = useState<{ filled?: string[]; targets?: string[]; error?: string }>();
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <div className="mb-4 space-y-2">
      {result?.error && <Alert>{t(result.error)}</Alert>}
      {result?.filled && (
        <Notice tone={result.filled.length || result.targets?.length ? "success" : "info"}>
          {result.filled.length ? `${t("Added recommended ranges and critical limits to: {tests}.", { tests: result.filled.join(", ") })} ` : ""}
          {result.targets?.length ? t("Added target times and specimens to: {tests}.", { tests: result.targets.join(", ") }) : ""}
          {!result.filled.length && !result.targets?.length && t("Every common test already has its own ranges, target time and specimen; nothing was changed.")}
        </Notice>
      )}
      <p className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        {t("Common tests (haemoglobin, CBC, glucose, creatinine…) have recommended critical limits, ranges for men, women and children, target times and specimens.")}
        <button type="button" disabled={pending} onClick={() => start(async () => setResult(await applyRecommendedLabRanges()))} className={secondaryButtonClass}>
          {pending ? t("Adding…") : t("Use the recommended ranges")}
        </button>
      </p>
      <p className="text-xs text-slate-500">{t("Only what a test doesn't have yet is filled in. Have your laboratory head check them against your analysers.")}</p>
    </div>
  );
}

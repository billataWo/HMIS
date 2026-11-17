"use client";

import { useEffect, useState, useTransition } from "react";
import { addDiagnosis, removeDiagnosis, searchIcd } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, Badge, inputClass, secondaryButtonClass } from "@/components/ui";
import type { Diagnosis, IcdEntry } from "@/lib/api";

export function DiagnosisPanel({ visitId, diagnoses, editable }: { visitId: string; diagnoses: Diagnosis[]; editable: boolean }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<IcdEntry[]>([]);
  const results = q.trim().length < 2 ? [] : found;
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState(false);
  const [pending, start] = useTransition();
  const t = useT();

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await searchIcd(q);
      if (!cancelled) setFound(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const add = (icd11Code: string, label: string) =>
    start(async () => {
      setError(undefined);
      const res = await addDiagnosis(visitId, { icd11Code, label });
      if (res.error) setError(res.error);
      else {
        setQ("");
        setFound([]);
        setManual(false);
      }
    });

  return (
    <section id="diagnoses" className="surface scroll-mt-6 space-y-4 p-5">
      <h2 className="font-semibold text-slate-900 dark:text-white">{t("Diagnoses")}</h2>
      {diagnoses.length === 0 ? (
        <p className="text-sm text-slate-500">{t("No diagnosis recorded yet.")}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {diagnoses.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-900">
              <span>
                <span className="font-mono text-xs text-slate-500">{d.icd11Code}</span> {d.label}
                {d.isPrimary && (
                  <span className="ml-2">
                    <Badge tone="brand">{t("Primary")}</Badge>
                  </span>
                )}
              </span>
              {editable && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(() => removeDiagnosis(visitId, d.id))}
                  className="text-xs text-red-700 hover:underline dark:text-red-400"
                  aria-label={t("Remove {name}", { name: d.label })}
                >
                  {t("Remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="space-y-2">
          {error && <Alert>{t(error)}</Alert>}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search diagnosis: malaria, ወባ, CA40…")}
            className={inputClass}
            aria-label={t("Search ICD-11 diagnoses")}
          />
          {results.length > 0 && (
            <ul className="max-h-64 overflow-y-auto rounded-md border border-slate-200 text-sm dark:border-slate-800">
              {results.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => add(r.code, r.label)}
                    className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="w-14 shrink-0 font-mono text-xs leading-5 text-slate-500">{r.code}</span>
                    <span>
                      {r.label}
                      {r.labelAm && <span className="text-slate-500"> · {r.labelAm}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results.length === 0 && <p className="text-xs text-slate-500">{t("Not in the common list.")}</p>}
          {manual ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                add(String(f.get("code")), String(f.get("label")));
              }}
            >
              <input name="code" required placeholder={t("ICD-11 code")} className={`${inputClass} w-32`} />
              <input name="label" required placeholder={t("Diagnosis")} className={`${inputClass} flex-1`} />
              <button className={secondaryButtonClass} disabled={pending}>
                {t("Add")}
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setManual(true)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
              {t("Enter an ICD-11 code by hand")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { addDiagnosis, removeDiagnosis, searchIcd } from "@/app/actions";
import { Alert, inputClass, secondaryButtonClass } from "@/components/ui";
import type { Diagnosis, IcdEntry } from "@/lib/api";

export function DiagnosisPanel({ visitId, diagnoses, editable }: { visitId: string; diagnoses: Diagnosis[]; editable: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<IcdEntry[]>([]);
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchIcd(q);
      if (!cancelled) setResults(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const add = (icd11Code: string, label: string) =>
    start(async () => {
      setError(undefined);
      const res = await addDiagnosis(visitId, { icd11Code, label });
      if (res.error) setError(res.error);
      else {
        setQ("");
        setResults([]);
        setManual(false);
      }
    });

  return (
    <section className="space-y-3">
      <h2 className="font-medium">Diagnoses</h2>
      {diagnoses.length === 0 ? (
        <p className="text-sm text-zinc-500">No diagnosis recorded yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {diagnoses.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
              <span>
                <span className="font-mono text-xs text-zinc-500">{d.icd11Code}</span> {d.label}
                {d.isPrimary && <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-900 dark:bg-teal-950 dark:text-teal-100">primary</span>}
              </span>
              {editable && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(() => removeDiagnosis(visitId, d.id))}
                  className="text-xs text-red-700 hover:underline dark:text-red-400"
                  aria-label={`Remove ${d.label}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="space-y-2">
          {error && <Alert>{error}</Alert>}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search diagnosis: malaria, ወባ, CA40…"
            className={inputClass}
            aria-label="Search ICD-11 diagnoses"
          />
          {results.length > 0 && (
            <ul className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 text-sm dark:border-zinc-800">
              {results.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => add(r.code, r.label)}
                    className="flex w-full gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="w-14 shrink-0 font-mono text-xs leading-5 text-zinc-500">{r.code}</span>
                    <span>
                      {r.label}
                      {r.labelAm && <span className="text-zinc-500"> · {r.labelAm}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results.length === 0 && <p className="text-xs text-zinc-500">Not in the common list.</p>}
          {manual ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                add(String(f.get("code")), String(f.get("label")));
              }}
            >
              <input name="code" required placeholder="ICD-11 code" className={`${inputClass} w-32`} />
              <input name="label" required placeholder="Diagnosis" className={`${inputClass} flex-1`} />
              <button className={secondaryButtonClass} disabled={pending}>
                Add
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setManual(true)} className="text-xs text-teal-700 hover:underline dark:text-teal-400">
              Enter an ICD-11 code by hand
            </button>
          )}
        </div>
      )}
    </section>
  );
}

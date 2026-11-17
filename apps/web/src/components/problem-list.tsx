"use client";

import { useState, useTransition } from "react";
import { addProblem, setProblemStatus } from "@/app/actions";
import type { PatientProblem } from "@/lib/api";
import { useT } from "./lang-provider";
import { Alert, buttonClass, inputClass, secondaryButtonClass } from "./ui";

const small = "px-2.5 py-1 text-xs";

/**
 * The patient's problem list: conditions they live with, shown at every consultation. The doctor
 * keeps it: adds this visit's diagnosis with one click (or types one), and resolves what is over.
 */
export function ProblemList({
  patientId,
  problems,
  canEdit,
  fromVisit = [],
}: {
  patientId: string;
  problems: PatientProblem[];
  canEdit: boolean;
  /** This visit's diagnoses, offered for the list when not on it yet. */
  fromVisit?: { icd11Code: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [since, setSince] = useState("");
  const t = useT();
  const active = problems.filter((p) => p.status === "ACTIVE");
  const resolved = problems.filter((p) => p.status === "RESOLVED");
  const listed = (d: { icd11Code: string; label: string }) => active.some((p) => p.icd11Code === d.icd11Code || p.label.toLowerCase() === d.label.toLowerCase());
  const offer = fromVisit.filter((d) => !listed(d));
  const add = (body: { label: string; icd11Code?: string | null; since?: string | null }) =>
    start(async () => {
      setError(undefined);
      const r = await addProblem(patientId, body);
      if (r.error) setError(r.error);
      else {
        setAdding(false);
        setLabel("");
        setSince("");
      }
    });

  return (
    <section id="problems" className="surface scroll-mt-6 space-y-2 p-4 text-sm dark:border-slate-800">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t("Problem list")}</h2>
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
            {t("Add")}
          </button>
        )}
      </div>
      {error && <Alert>{t(error)}</Alert>}
      {active.length === 0 ? (
        <p className="text-slate-500">{t("No long-term conditions recorded.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {active.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-2">
              <span>
                <span className="font-medium">{p.label}</span>
                {p.icd11Code && <span className="font-mono text-xs text-slate-500"> {p.icd11Code}</span>}
                {p.since && <span className="text-xs text-slate-500"> · {t("since {year}", { year: p.since.slice(0, 4) })}</span>}
              </span>
              {canEdit && (
                <button type="button" disabled={pending} onClick={() => start(() => setProblemStatus(p.id, "RESOLVED"))} className="text-xs text-slate-500 hover:underline">
                  {t("Resolved")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && offer.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
          <p className="text-xs text-slate-500">{t("Today's diagnosis is a long-term condition?")}</p>
          {offer.map((d) => (
            <button
              key={d.icd11Code}
              type="button"
              disabled={pending}
              onClick={() => add({ label: d.label, icd11Code: d.icd11Code })}
              className={`${secondaryButtonClass} ${small} mr-1`}
            >
              + {d.label}
            </button>
          ))}
        </div>
      )}
      {adding && (
        <div className="space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Condition (e.g. Epilepsy)")} aria-label={t("Condition")} className={inputClass} />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            {t("Since")}
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label={t("Since")} className={`${inputClass} w-auto py-1`} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={pending || label.trim().length < 2} onClick={() => add({ label: label.trim(), since: since || null })} className={`${buttonClass} ${small}`}>
              {t("Add to list")}
            </button>
            <button type="button" onClick={() => setAdding(false)} className={`${secondaryButtonClass} ${small}`}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {resolved.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{t("Resolved ({n})", { n: resolved.length })}</summary>
          <ul className="mt-1 space-y-1">
            {resolved.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-2">
                <span className="line-through">{p.label}</span>
                {canEdit && (
                  <button type="button" disabled={pending} onClick={() => start(() => setProblemStatus(p.id, "ACTIVE"))} className="hover:underline">
                    {t("Active again")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

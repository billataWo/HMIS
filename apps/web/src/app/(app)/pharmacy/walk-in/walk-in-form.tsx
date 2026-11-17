"use client";

import { ControlledBadge } from "@/components/controlled-badge";
import { Search, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { searchDrugs, searchPatients, walkInSale, type FormState } from "@/app/actions";
import { AllergyAlert } from "@/components/allergy-alert";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { DrugOption, Patient } from "@/lib/api";
import { etb, fullName } from "@/lib/format";

/** Debounced search shared by the two pickers below. */
function useSearch<T>(q: string, run: (q: string) => Promise<T[]>) {
  const [found, setFound] = useState<T[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await run(q);
      if (!cancelled) setFound(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, run]);
  return q.trim().length < 2 ? [] : found;
}

export function WalkInForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(walkInSale, {});
  const [patient, setPatient] = useState<Patient | null>(null);
  const [pq, setPq] = useState("");
  const [dq, setDq] = useState("");
  const [lines, setLines] = useState<{ drug: DrugOption; qty: number }[]>([]);
  const patients = useSearch(pq, searchPatients);
  const drugs = useSearch(dq, searchDrugs);
  const total = lines.reduce((s, l) => s + Number(l.drug.sellPrice) * l.qty, 0);
  const t = useT();

  return (
    <form action={action} className="space-y-6">
      {state.error && <Alert>{t(state.error)}</Alert>}

      <section className="surface space-y-3 p-5">
        <h2 className="font-semibold">{t("Customer")}</h2>
        {patient ? (
          <div className="space-y-2">
            <input type="hidden" name="patientId" value={patient.id} />
            <p className="flex items-center gap-2 text-sm">
              <span className="font-medium">{fullName(patient)}</span>
              <span className="text-slate-500">{patient.mrn}</span>
              <button type="button" onClick={() => setPatient(null)} aria-label={t("Remove customer")} className="rounded p-1 text-slate-500 hover:text-red-700">
                <X aria-hidden className="size-4" />
              </button>
            </p>
            <AllergyAlert allergies={patient.allergies} className="" />
            {patient.allergies.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="acknowledge" /> {t("I have checked the drugs against these allergies")}
              </label>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500">{t("Optional. Leave empty for an unnamed walk-in customer; choose a registered patient to check their allergies and the medicines they are taking.")}</p>
            <div className="relative max-w-md">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder={t("Name, phone or MRN")} aria-label={t("Find a registered patient")} className={`${inputClass} pl-9`} />
            </div>
            {patients.length > 0 && (
              <ul className="max-w-md divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                {patients.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => (setPatient(p), setPq(""))} className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                      {fullName(p)} <span className="text-slate-500">· {p.mrn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="font-semibold">{t("Drugs")}</h2>
        <div className="relative max-w-md">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input value={dq} onChange={(e) => setDq(e.target.value)} placeholder={t("Search drugs: paracetamol, ORS…")} aria-label={t("Find a drug")} className={`${inputClass} pl-9`} />
        </div>
        {drugs.length > 0 && (
          <ul className="max-w-xl divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
            {drugs
              .filter((d) => !lines.some((l) => l.drug.id === d.id))
              .map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    disabled={d.inStock === 0 || !!d.controlled}
                    onClick={() => (setLines((ls) => [...ls, { drug: d, qty: 1 }]), setDq(""))}
                    className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                  >
                    <span>
                      {d.genericName} {d.strength} {d.form} <ControlledBadge c={d.controlled} />
                    </span>
                    <span className="text-slate-500">
                      {d.controlled ? t("Doctor's prescription only") : `${etb(d.sellPrice, t)} · ${d.inStock ? t("{n} in stock", { n: d.inStock }) : t("out of stock")}`}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">{t("No drugs added yet.")}</p>
        ) : (
          <table className="w-full max-w-2xl text-left text-sm">
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.drug.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">
                    {l.drug.genericName} {l.drug.strength} {l.drug.form}
                    <span className="block text-xs text-slate-500">
                      {etb(l.drug.sellPrice, t)} / {l.drug.unit} · {t("{n} in stock", { n: l.drug.inStock })}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      name={`qty_${l.drug.id}`}
                      type="number"
                      min={1}
                      max={l.drug.inStock}
                      value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))}
                      aria-label={t("Quantity of {drug}", { drug: l.drug.genericName })}
                      className="w-24"
                    />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{etb(Number(l.drug.sellPrice) * l.qty, t)}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={t("Remove {drug}", { drug: l.drug.genericName })} className="rounded p-1 text-slate-500 hover:text-red-700">
                      <X aria-hidden className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
                <td colSpan={2} className="py-2">
                  {t("Total")}
                </td>
                <td className="py-2 text-right tabular-nums">{etb(total, t)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {state.alerts && state.alerts.length > 0 && !pending && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <ul className="list-disc space-y-1 pl-5">
            {state.alerts.map((a, i) => (
              <li key={i}>
                <span className="font-medium">{t(a.type === "ALLERGY" ? "Allergy" : a.type === "DUPLICATE" ? "Duplicate" : a.severity === "MAJOR" ? "Major interaction" : "Interaction")}:</span> {t(a.message)}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="acknowledge" /> {t("I have checked these and advised the customer")}
          </label>
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending || lines.length === 0} className={buttonClass}>
          {pending ? t("Saving…") : t("Create sale")}
        </button>
        <a href="/pharmacy" className={secondaryButtonClass}>
          {t("Cancel")}
        </a>
      </div>
    </form>
  );
}

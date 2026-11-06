"use client";

import { useEffect, useState, useTransition } from "react";
import { cancelPrescription, createPrescription, searchDrugs, type RxDraftItem } from "@/app/actions";
import { Alert, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { DrugOption, Frequency, Prescription, RxAlert } from "@/lib/api";

const FREQUENCIES: { value: Frequency; label: string; perDay: number | null }[] = [
  { value: "OD", label: "OD · once daily", perDay: 1 },
  { value: "BID", label: "BID · twice daily", perDay: 2 },
  { value: "TID", label: "TID · 3 times daily", perDay: 3 },
  { value: "QID", label: "QID · 4 times daily", perDay: 4 },
  { value: "NOCTE", label: "Nocte · at night", perDay: 1 },
  { value: "PRN", label: "PRN · when needed", perDay: null },
  { value: "STAT", label: "STAT · once now", perDay: null },
];

const RX_STATUS: Record<Prescription["status"], string> = {
  PENDING: "Waiting at pharmacy",
  PARTIALLY_DISPENSED: "Partly dispensed",
  DISPENSED: "Dispensed",
  CANCELLED: "Cancelled",
};

type Draft = RxDraftItem & { drug: DrugOption; quantityEdited: boolean };

/** Units for the whole course, assuming one unit per dose; the doctor can change it. */
function suggestQuantity(freq: Frequency, days?: number) {
  const perDay = FREQUENCIES.find((f) => f.value === freq)?.perDay;
  if (freq === "STAT") return 1;
  return perDay && days ? perDay * days : 1;
}

const drugLabel = (d: Pick<DrugOption, "genericName" | "strength" | "form">) => [d.genericName, d.strength, d.form].filter(Boolean).join(" ");

export function PrescriptionPanel({ visitId, prescriptions, editable }: { visitId: string; prescriptions: Prescription[]; editable: boolean }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DrugOption[]>([]);
  const results = q.trim().length < 2 ? [] : found;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [alerts, setAlerts] = useState<RxAlert[]>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchDrugs(q);
      if (!cancelled) setFound(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const addDraft = (drug: DrugOption) => {
    setDrafts((d) => [
      ...d,
      { drug, drugId: drug.id, dose: `1 ${drug.unit}`, frequency: "TID", durationDays: 5, quantity: suggestQuantity("TID", 5), quantityEdited: false },
    ]);
    setQ("");
    setFound([]);
    setAlerts(undefined);
  };

  // Any change to the draft invalidates alerts the doctor has seen, so they must be re-checked.
  const update = (i: number, patch: Partial<Draft>) => {
    setAlerts(undefined);
    setDrafts((ds) =>
      ds.map((d, j) => {
        if (j !== i) return d;
        const next = { ...d, ...patch };
        if (!next.quantityEdited && ("frequency" in patch || "durationDays" in patch)) {
          next.quantity = suggestQuantity(next.frequency, next.durationDays);
        }
        return next;
      }),
    );
  };

  const submit = (confirm?: boolean) =>
    start(async () => {
      setError(undefined);
      const items = drafts.map(({ drugId, dose, frequency, durationDays, quantity, instructions }) => ({
        drugId,
        dose,
        frequency,
        durationDays,
        quantity,
        instructions,
      }));
      const res = await createPrescription(visitId, items, confirm ? { overrideReason: reason } : undefined);
      if (res.ok) {
        setDrafts([]);
        setAlerts(undefined);
        setReason("");
      } else {
        setAlerts(res.alerts);
        setError(res.error);
      }
    });

  const blocking = alerts?.some((a) => a.severity === "BLOCK");

  return (
    <section id="prescriptions" className="surface scroll-mt-6 space-y-4 p-5">
      <h2 className="font-semibold text-slate-900 dark:text-white">Prescriptions</h2>

      {prescriptions.length === 0 && drafts.length === 0 && <p className="text-sm text-slate-500">Nothing prescribed yet.</p>}
      {prescriptions.map((p) => (
        <div key={p.id} className={`rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800 ${p.status === "CANCELLED" ? "opacity-60" : ""}`}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              {RX_STATUS[p.status]} · Dr. {p.prescriber.fullName}
            </span>
            {editable && p.status === "PENDING" && (
              <button type="button" disabled={pending} onClick={() => start(() => cancelPrescription(p.id))} className="text-xs text-red-700 hover:underline dark:text-red-400">
                Cancel
              </button>
            )}
          </div>
          <ul className="space-y-0.5">
            {p.items.map((i) => (
              <li key={i.id} className={p.status === "CANCELLED" ? "line-through" : ""}>
                <span className="font-medium">{drugLabel(i.drug)}</span> · {i.dose} {i.frequency}
                {i.durationDays && ` × ${i.durationDays} days`} · qty {i.quantity}
                {i.dispensedQty > 0 && i.dispensedQty < i.quantity && <span className="text-slate-500"> ({i.dispensedQty} given)</span>}
                {i.instructions && <span className="block text-xs text-slate-500">{i.instructions}</span>}
              </li>
            ))}
          </ul>
          {p.alerts && p.alerts.length > 0 && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              Accepted alerts: {p.alerts.map((a) => a.message).join("; ")}
              {p.overrideReason && ` · Reason: ${p.overrideReason}`}
            </p>
          )}
        </div>
      ))}

      {editable && (
        <div className="space-y-3 rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-700">
          {drafts.map((d, i) => (
            <div key={i} className="space-y-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{drugLabel(d.drug)}</span>
                  <span className={`ml-2 text-xs ${d.drug.inStock >= d.quantity ? "text-slate-500" : "text-red-700 dark:text-red-400"}`}>
                    {d.drug.inStock} in stock
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAlerts(undefined);
                    setDrafts((ds) => ds.filter((_, j) => j !== i));
                  }} className="text-xs text-red-700 hover:underline dark:text-red-400" aria-label={`Remove ${d.drug.genericName}`}>
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <input value={d.dose} onChange={(e) => update(i, { dose: e.target.value })} aria-label="Dose" placeholder="Dose" className={inputClass} />
                <select value={d.frequency} onChange={(e) => update(i, { frequency: e.target.value as Frequency })} aria-label="Frequency" className={inputClass}>
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={d.durationDays ?? ""}
                    onChange={(e) => update(i, { durationDays: e.target.value ? Number(e.target.value) : undefined })}
                    aria-label="Days"
                    className={inputClass}
                  />
                  days
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  qty
                  <input
                    type="number"
                    min={1}
                    value={d.quantity}
                    onChange={(e) => update(i, { quantity: Number(e.target.value), quantityEdited: true })}
                    aria-label="Quantity"
                    className={inputClass}
                  />
                </label>
              </div>
              <input
                value={d.instructions ?? ""}
                onChange={(e) => update(i, { instructions: e.target.value })}
                placeholder="Instructions, e.g. after meals"
                aria-label="Instructions"
                className={inputClass}
              />
            </div>
          ))}

          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a drug: amoxicillin, nsaid…" aria-label="Search drugs" className={inputClass} />
          {results.length > 0 && (
            <ul className="max-h-60 overflow-y-auto rounded-md border border-slate-200 text-sm dark:border-slate-800">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => addDraft(r)} className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
                    <span>
                      {drugLabel(r)}
                      {r.drugClass && <span className="text-xs text-slate-500"> · {r.drugClass}</span>}
                    </span>
                    <span className={`text-xs ${r.inStock > 0 ? "text-slate-500" : "text-red-700 dark:text-red-400"}`}>
                      {r.inStock > 0 ? `${r.inStock} in stock` : "out of stock"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results.length === 0 && <p className="text-xs text-slate-500">No matching drug in this clinic&apos;s list.</p>}

          {alerts && alerts.length > 0 && (
            <div role="alert" className={`space-y-2 rounded-md border p-3 text-sm ${blocking ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"}`}>
              <p className="font-medium">{blocking ? "Allergy alert" : "Check before prescribing"}</p>
              <ul className="list-disc pl-5">
                {alerts.map((a, i) => (
                  <li key={i}>
                    <span className="font-medium">{a.severity === "BLOCK" ? "Allergy" : a.severity === "MAJOR" ? "Major" : "Moderate"}:</span> {a.message}
                  </li>
                ))}
              </ul>
              {blocking && (
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Reason for prescribing despite the allergy (required)"
                  className={inputClass}
                />
              )}
              <div className="flex gap-2">
                <button type="button" disabled={pending || (blocking && reason.trim().length < 5)} onClick={() => submit(true)} className={buttonClass}>
                  {blocking ? "Override and prescribe" : "Prescribe anyway"}
                </button>
                <button type="button" onClick={() => setAlerts(undefined)} className={secondaryButtonClass}>
                  Change prescription
                </button>
              </div>
            </div>
          )}
          {error && <Alert>{error}</Alert>}

          {drafts.length > 0 && !alerts && (
            <button type="button" disabled={pending} onClick={() => submit()} className={buttonClass}>
              {pending ? "Checking…" : `Prescribe ${drafts.length} ${drafts.length === 1 ? "drug" : "drugs"}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

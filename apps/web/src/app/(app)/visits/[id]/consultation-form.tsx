"use client";

import { useActionState, useRef, useState } from "react";
import { saveConsultation, type FormState } from "@/app/actions";
import { Alert, buttonClass, Field, inputClass, secondaryButtonClass } from "@/components/ui";
import type { VisitDetail, VisitStatus } from "@/lib/api";

type Mode = "doctor" | "nurse";

const VITALS: { name: keyof VisitDetail; label: string; unit: string; step: string; min: number; max: number }[] = [
  { name: "temperatureC", label: "Temp", unit: "°C", step: "0.1", min: 25, max: 45 },
  { name: "pulse", label: "Pulse", unit: "/min", step: "1", min: 20, max: 250 },
  { name: "systolicBp", label: "BP systolic", unit: "mmHg", step: "1", min: 50, max: 300 },
  { name: "diastolicBp", label: "BP diastolic", unit: "mmHg", step: "1", min: 20, max: 200 },
  { name: "respRate", label: "Resp. rate", unit: "/min", step: "1", min: 5, max: 80 },
  { name: "spo2", label: "SpO₂", unit: "%", step: "1", min: 50, max: 100 },
  { name: "weightKg", label: "Weight", unit: "kg", step: "0.1", min: 0.3, max: 300 },
  { name: "heightCm", label: "Height", unit: "cm", step: "0.1", min: 20, max: 250 },
];

// Quick-insert text for common normal findings; the doctor edits from there.
const EXAM_TEMPLATES: { label: string; text: string }[] = [
  { label: "General: normal", text: "Alert, not in distress. No pallor, no jaundice, no lymphadenopathy." },
  { label: "Chest: normal", text: "Chest: clear, good air entry bilaterally, no added sounds." },
  { label: "CVS: normal", text: "CVS: S1 S2 heard, no murmur." },
  { label: "Abdomen: normal", text: "Abdomen: soft, non-tender, no organomegaly." },
];

const NEXT: Partial<Record<VisitStatus, { to: VisitStatus; label: string }[]>> = {
  IN_CONSULTATION: [
    { to: "AWAITING_LAB", label: "Save & send to lab" },
    { to: "AWAITING_PHARMACY", label: "Save & send to pharmacy" },
    { to: "COMPLETED", label: "Save & complete visit" },
  ],
  AWAITING_LAB: [{ to: "COMPLETED", label: "Save & complete visit" }],
};

function bmi(weight: string, height: string) {
  const w = Number(weight);
  const h = Number(height) / 100;
  if (!w || !h) return null;
  return (w / (h * h)).toFixed(1);
}

export function ConsultationForm({ visit, mode }: { visit: VisitDetail; mode: Mode }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveConsultation, {});
  const err = state.fieldErrors ?? {};
  // After a failed save, show what was typed (React resets uncontrolled fields after an action).
  const initial = (k: keyof VisitDetail) => {
    if (state.error && state.values && k in state.values) return state.values[k as string];
    const v = visit[k];
    return v === null || v === undefined ? "" : String(v);
  };
  const [weight, setWeight] = useState(initial("weightKg"));
  const [height, setHeight] = useState(initial("heightCm"));
  const exam = useRef<HTMLTextAreaElement>(null);
  const insert = (text: string) => {
    const el = exam.current;
    if (!el) return;
    el.value = el.value ? `${el.value.trimEnd()}\n${text}` : text;
    el.focus();
  };
  const steps = mode === "doctor" ? (NEXT[visit.status] ?? []) : [];

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="visitId" value={visit.id} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          Saved.
        </p>
      )}

      <section>
        <h2 className="mb-2 font-medium">Vitals</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {VITALS.map((f) => (
            <Field key={f.name} label={`${f.label} (${f.unit})`} error={err[f.name]}>
              <input
                name={f.name}
                type="number"
                inputMode="decimal"
                step={f.step}
                min={f.min}
                max={f.max}
                defaultValue={f.name === "weightKg" || f.name === "heightCm" ? undefined : initial(f.name)}
                value={f.name === "weightKg" ? weight : f.name === "heightCm" ? height : undefined}
                onChange={
                  f.name === "weightKg" ? (e) => setWeight(e.target.value) : f.name === "heightCm" ? (e) => setHeight(e.target.value) : undefined
                }
                className={inputClass}
              />
            </Field>
          ))}
        </div>
        {bmi(weight, height) && <p className="mt-2 text-sm text-zinc-500">BMI {bmi(weight, height)} kg/m²</p>}
      </section>

      <section className="space-y-4">
        <Field label="Chief complaint" error={err.chiefComplaint}>
          <textarea name="chiefComplaint" rows={2} defaultValue={initial("chiefComplaint")} className={inputClass} />
        </Field>
        {mode === "doctor" && (
          <>
            <Field label="History" error={err.history}>
              <textarea name="history" rows={4} defaultValue={initial("history")} className={inputClass} />
            </Field>
            <div className="space-y-1">
              <Field label="Examination" error={err.examination}>
                <textarea ref={exam} name="examination" rows={4} defaultValue={initial("examination")} className={inputClass} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {EXAM_TEMPLATES.map((t) => (
                  <button key={t.label} type="button" onClick={() => insert(t.text)} className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                    + {t.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Plan" error={err.plan}>
              <textarea name="plan" rows={3} defaultValue={initial("plan")} className={inputClass} />
            </Field>
          </>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={steps.length ? secondaryButtonClass : buttonClass}>
          {pending ? "Saving…" : mode === "nurse" ? "Save triage" : "Save"}
        </button>
        {steps.map((s) => (
          <button
            key={s.to}
            type="submit"
            name="then"
            value={s.to}
            disabled={pending}
            className={s.to === "COMPLETED" ? buttonClass : secondaryButtonClass}
          >
            {s.label}
          </button>
        ))}
      </div>
    </form>
  );
}

"use client";

import { LoaderCircle, Plus, TriangleAlert } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { saveConsultation, type FormState } from "@/app/actions";
import { Reveal } from "@/components/motion";
import { Alert, Badge, buttonClass, Field, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { VisitDetail, VisitStatus } from "@/lib/api";
import { ageFrom } from "@/lib/format";
import { bmiFlag, suggestTriage, TRIAGE, type TriageLevel, vitalFlag } from "./vital-flags";

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
  { name: "muacMm", label: "MUAC", unit: "mm", step: "1", min: 50, max: 400 },
];

/** Whole months from a date of birth to a day (null when the birth date isn't known). */
function monthsOld(dob: string | null, on: string) {
  if (!dob) return null;
  const a = new Date(dob);
  const b = new Date(on);
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0));
}

/** "9 weeks · due 12 Jun 2027" from the first day of the last period. */
function gestation(lmp: string, on: string) {
  if (!lmp) return null;
  const start = new Date(`${lmp}T00:00:00Z`);
  const weeks = Math.floor((new Date(on).getTime() - start.getTime()) / (7 * 86_400_000));
  if (!Number.isFinite(weeks) || weeks < 0 || weeks > 44) return null;
  const due = new Date(start.getTime() + 280 * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${weeks} weeks · due ${due}`;
}

// Quick-insert text for common normal findings; the doctor edits from there.
const EXAM_TEMPLATES: { label: string; text: string }[] = [
  { label: "General: normal", text: "Alert, not in distress. No pallor, no jaundice, no lymphadenopathy." },
  { label: "Chest: normal", text: "Chest: clear, good air entry bilaterally, no added sounds." },
  { label: "CVS: normal", text: "CVS: S1 S2 heard, no murmur." },
  { label: "Abdomen: normal", text: "Abdomen: soft, non-tender, no organomegaly." },
];

type CaseTemplate = { label: string; complaint: string; history: string; examination: string; plan: string };

/**
 * Starting points for common OPD presentations; blanks (_) are filled in by the doctor. Deliberately
 * without drug doses: treatment follows the national guidelines. Have the clinical advisor review
 * and extend these for the clinic.
 */
const CASE_TEMPLATES: CaseTemplate[] = [
  {
    label: "Fever, suspected malaria",
    complaint: "Fever, headache, chills for _ days",
    history: "Fever for _ days with chills and headache. Travel to or lives in a malarious area: _. No cough, urinary symptoms or diarrhoea. Previous malaria: _.",
    examination: "T _ °C. Pallor: _. No jaundice. No neck stiffness. Spleen: _.",
    plan: "Malaria blood film / RDT. If positive, treat per national malaria guideline. Fever control. Return at once if vomiting, confusion, convulsions or not improving in 48 h.",
  },
  {
    label: "Upper respiratory infection",
    complaint: "Cough, sore throat, runny nose for _ days",
    history: "Cough for _ days, dry / productive. Sore throat, nasal discharge. No shortness of breath, chest pain or high fever.",
    examination: "T _ °C, RR _/min, SpO₂ _%. Throat: _. Chest clear.",
    plan: "Symptomatic care, fluids, rest. Antibiotics only if bacterial features. Return if breathing difficulty or fever beyond 3 days.",
  },
  {
    label: "Community-acquired pneumonia",
    complaint: "Cough, fever and difficult breathing for _ days",
    history: "Productive cough for _ days with fever. Pleuritic chest pain: _. Shortness of breath: _. TB contact or weight loss: _.",
    examination: "T _ °C, RR _/min, SpO₂ _%, pulse _/min. Chest: crackles / bronchial breathing over _.",
    plan: "Assess severity (CURB-65). Treat per guideline; refer if SpO₂ low or severe. Sputum for AFB if cough > 2 weeks. Review in 48 h.",
  },
  {
    label: "Urinary tract infection",
    complaint: "Burning urination and frequency for _ days",
    history: "Dysuria, frequency, urgency for _ days. Flank pain / fever: _. Pregnancy possible: _.",
    examination: "T _ °C. Suprapubic tenderness: _. Costovertebral angle tenderness: _.",
    plan: "Urinalysis (and hCG if of childbearing age). Treat per guideline. Increase fluids. Return if fever, flank pain or vomiting.",
  },
  {
    label: "Acute gastroenteritis",
    complaint: "Diarrhoea and vomiting for _ days",
    history: "Watery / bloody diarrhoea _ times a day for _ days. Vomiting: _. Fever: _. Able to drink: _.",
    examination: "T _ °C, pulse _/min, BP _/_. Dehydration: none / some / severe. Abdomen soft, tenderness: _.",
    plan: "ORS and zinc (children). Stool examination if bloody or prolonged. Danger signs explained: unable to drink, blood in stool, drowsiness.",
  },
  {
    label: "Dyspepsia / gastritis",
    complaint: "Upper abdominal burning pain for _",
    history: "Epigastric pain related to meals for _. NSAID use: _. Alarm features (weight loss, vomiting blood, black stool, difficulty swallowing): none.",
    examination: "Epigastric tenderness: _. No mass. Not pale.",
    plan: "H. pylori stool antigen. Avoid NSAIDs, alcohol and smoking. Treat per guideline. Refer for endoscopy if alarm features.",
  },
  {
    label: "Hypertension follow-up",
    complaint: "Follow-up for hypertension",
    history: "Known hypertensive since _, on _. Adherence: _. Headache, chest pain, shortness of breath, swelling: _.",
    examination: "BP _/_ (repeat _/_), pulse _/min, weight _ kg. No oedema.",
    plan: "Continue / adjust treatment to reach target BP. Salt reduction, exercise. Creatinine and glucose yearly. Next visit in _ weeks.",
  },
  {
    label: "Diabetes follow-up",
    complaint: "Follow-up for diabetes",
    history: "Known diabetic since _, on _. Adherence: _. Hypoglycaemia episodes: _. Thirst, urination, vision, foot problems: _.",
    examination: "Weight _ kg, BP _/_. Feet: sensation and pulses _, ulcers: none.",
    plan: "Fasting glucose / HbA1c. Adjust treatment to target. Foot care and diet advice. Next visit in _ weeks.",
  },
];

type Step = { to: VisitStatus; label: string; primary?: boolean; blocked?: { hint: string; anchor: string } };

/**
 * The hand-offs offered under the form, mirroring the API's rules: a test must be ordered before
 * "send to lab", a prescription before "send to pharmacy", and a visit can't be completed while
 * results are pending or drugs are still to be collected (the pharmacy closes it instead).
 */
function nextSteps(status: VisitStatus, open: { lab: boolean; rx: boolean; diagnosed: boolean }): Step[] {
  const labPending = { hint: "Waiting for lab results", anchor: "#lab-tests" };
  const drugsToCollect = { hint: "Drugs to collect: send to the pharmacy", anchor: "#prescriptions" };
  const noDiagnosis = { hint: "Add a diagnosis first", anchor: "#diagnoses" };
  if (status === "IN_CONSULTATION") {
    return [
      { to: "AWAITING_LAB", label: "Save & send to lab", primary: open.lab, blocked: open.lab ? undefined : { hint: "Order a test under Lab tests first", anchor: "#lab-tests" } },
      { to: "AWAITING_PHARMACY", label: "Save & send to pharmacy", primary: open.rx && !open.lab, blocked: !open.rx ? { hint: "Write a prescription first", anchor: "#prescriptions" } : !open.diagnosed ? noDiagnosis : undefined },
      { to: "COMPLETED", label: "Save & complete visit", primary: !open.lab && !open.rx, blocked: open.lab ? labPending : open.rx ? drugsToCollect : !open.diagnosed ? noDiagnosis : undefined },
    ];
  }
  if (status === "AWAITING_LAB") {
    return [{ to: "COMPLETED", label: "Save & complete visit", primary: true, blocked: open.lab ? labPending : open.rx ? drugsToCollect : !open.diagnosed ? noDiagnosis : undefined }];
  }
  return [];
}

function bmi(weight: string, height: string) {
  const w = Number(weight);
  const h = Number(height) / 100;
  if (!w || !h) return null;
  return (w / (h * h)).toFixed(1);
}

export function ConsultationForm({
  visit,
  mode,
  open,
}: {
  visit: VisitDetail;
  mode: Mode;
  /** Whether the visit has unverified lab tests / drugs still to hand over, and has a diagnosis. */
  open: { lab: boolean; rx: boolean; diagnosed: boolean };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveConsultation, {});
  const err = state.fieldErrors ?? {};
  // After a failed save, show what was typed (React resets uncontrolled fields after an action).
  const initial = (k: keyof VisitDetail) => {
    if (state.error && state.values && k in state.values) return state.values[k as string];
    const v = visit[k];
    return v === null || v === undefined ? "" : String(v);
  };
  const [weight, setWeight] = useState(initial("weightKg"));
  // What has been typed in each vital, to flag adult values outside the usual range as they are entered.
  const [typed, setTyped] = useState<Record<string, string>>(() => Object.fromEntries(VITALS.map((f) => [f.name, initial(f.name)])));
  const age = ageFrom(visit.patient.dateOfBirth);
  const adult = age !== null && age >= 18;
  const ageMonths = monthsOld(visit.patient.dateOfBirth, visit.checkedInAt);
  // Pregnancy applies to women who could be pregnant (age unknown counts).
  const canBePregnant = visit.patient.sex === "FEMALE" && (age === null || (age >= 10 && age <= 55));
  const [pregnancy, setPregnancy] = useState(initial("pregnancyStatus" as keyof VisitDetail));
  const [lmp, setLmp] = useState(initial("lmpDate" as keyof VisitDetail).slice(0, 10));
  const [feeding, setFeeding] = useState(state.error && state.values ? state.values.breastfeeding === "on" : !!visit.breastfeeding);
  const ctx = { ageMonths, mother: pregnancy === "PREGNANT" || pregnancy === "POSSIBLE" || feeding };
  // MUAC: for children 6–59 months, and for women who are or may be pregnant or breastfeeding.
  const showMuac = (ageMonths !== null && ageMonths >= 6 && ageMonths < 60) || canBePregnant;
  const flagOf = (name: string) => vitalFlag(name, name === "weightKg" ? weight : name === "heightCm" ? height : (typed[name] ?? ""), ctx);
  const suggestion = suggestTriage(typed, ctx);
  const [triage, setTriage] = useState(initial("triageLevel" as keyof VisitDetail));
  const [height, setHeight] = useState(initial("heightCm"));
  const exam = useRef<HTMLTextAreaElement>(null);
  const complaint = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLTextAreaElement>(null);
  const plan = useRef<HTMLTextAreaElement>(null);
  // Fills empty fields and adds to the end of fields already started, so nothing typed is lost.
  const applyTemplate = (t: CaseTemplate) => {
    for (const [ref, text] of [
      [complaint, t.complaint],
      [history, t.history],
      [exam, t.examination],
      [plan, t.plan],
    ] as const) {
      const el = ref.current;
      if (el) el.value = el.value.trim() ? `${el.value.trimEnd()}\n${text}` : text;
    }
    history.current?.focus();
  };
  const insert = (text: string) => {
    const el = exam.current;
    if (!el) return;
    el.value = el.value ? `${el.value.trimEnd()}\n${text}` : text;
    el.focus();
  };
  const steps = mode === "doctor" ? nextSteps(visit.status, open) : [];

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="visitId" value={visit.id} />
      {state.error && <Alert>{state.error}</Alert>}
      <Reveal show={!!state.ok && !pending}>
        <Notice tone="success">Saved.</Notice>
      </Reveal>

      <section className="surface p-5">
        <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Vitals</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {VITALS.filter((f) => f.name !== "muacMm" || showMuac).map((f) => (
            <Field key={f.name} label={`${f.label} (${f.unit})`} error={err[f.name]}>
              <>
              <input
                name={f.name}
                type="number"
                inputMode="decimal"
                step={f.step}
                min={f.min}
                max={f.max}
                defaultValue={f.name === "weightKg" || f.name === "heightCm" ? undefined : initial(f.name)}
                value={f.name === "weightKg" ? weight : f.name === "heightCm" ? height : undefined}
                onChange={(e) => {
                  if (f.name === "weightKg") setWeight(e.target.value);
                  else if (f.name === "heightCm") setHeight(e.target.value);
                  else setTyped((t) => ({ ...t, [f.name]: e.target.value }));
                }}
                aria-describedby={flagOf(f.name) ? `${f.name}-flag` : undefined}
                className={`${inputClass} ${
                  flagOf(f.name) ? (flagOf(f.name)!.urgent ? "border-red-400! dark:border-red-700!" : "border-amber-400! dark:border-amber-700!") : ""
                }`}
              />
              {flagOf(f.name) && (
                <span
                  id={`${f.name}-flag`}
                  role="status"
                  className={`mt-1 flex items-center gap-1 text-xs font-medium ${
                    flagOf(f.name)!.urgent ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300"
                  }`}
                >
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  {flagOf(f.name)!.text}
                </span>
              )}
              </>
            </Field>
          ))}
        </div>
        {!adult && ageMonths !== null && (
          <p className="mt-3 text-xs text-slate-500">
            A child ({ageMonths < 24 ? `${ageMonths} months` : `${Math.floor(ageMonths / 12)} years`}): flags use the usual ranges for this age.
          </p>
        )}
        {ageMonths === null && <p className="mt-3 text-xs text-slate-500">Age unknown: only low oxygen is flagged automatically.</p>}
        {bmi(weight, height) && (
          <p className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="brand">BMI {bmi(weight, height)} kg/m²</Badge>
            {adult && bmiFlag(Number(bmi(weight, height))) && (
              <Badge tone={bmiFlag(Number(bmi(weight, height)))!.urgent ? "danger" : "warning"}>{bmiFlag(Number(bmi(weight, height)))!.text}</Badge>
            )}
          </p>
        )}

        {/* Triage priority: the queue is seen in this order (emergencies first). */}
        <fieldset className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <legend className="text-sm font-medium">Triage priority</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(TRIAGE) as TriageLevel[]).map((l) => (
              <label
                key={l}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ${
                  triage === l ? `${TRIAGE[l].tone} ring-transparent` : "ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                <input type="radio" name="triageLevel" value={l} checked={triage === l} onChange={() => setTriage(l)} className="sr-only" />
                <span aria-hidden className={`inline-block size-2.5 rounded-full ${TRIAGE[l].tone.split(" ")[0]} ${triage === l ? "ring-2 ring-white" : ""}`} />
                <span className="font-medium">{TRIAGE[l].label}</span>
                <span className={`text-xs ${triage === l ? "opacity-90" : "text-slate-500"}`}>{TRIAGE[l].hint}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Suggested from the vitals: <span className="font-medium">{TRIAGE[suggestion.level].label}</span>
            {suggestion.because && ` (${suggestion.because.toLowerCase()})`}. Look at the patient too: danger signs the vitals don&apos;t show come first.
          </p>
        </fieldset>

        {canBePregnant && (
          <fieldset className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <legend className="text-sm font-medium">Pregnancy and breastfeeding</legend>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <Field label="Could she be pregnant?" error={err.pregnancyStatus}>
                <select name="pregnancyStatus" value={pregnancy} onChange={(e) => setPregnancy(e.target.value)} className={`${inputClass} block w-auto`}>
                  <option value="">Not asked</option>
                  <option value="NOT_PREGNANT">Not pregnant</option>
                  <option value="POSSIBLE">Possibly (test pending)</option>
                  <option value="PREGNANT">Pregnant</option>
                </select>
              </Field>
              {pregnancy === "PREGNANT" && (
                <Field label="First day of last period" error={err.lmpDate}>
                  <input name="lmpDate" type="date" value={lmp} onChange={(e) => setLmp(e.target.value)} className={`${inputClass} block w-auto`} />
                </Field>
              )}
              {pregnancy === "PREGNANT" && gestation(lmp, visit.checkedInAt) && <Badge tone="violet">{gestation(lmp, visit.checkedInAt)}</Badge>}
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="hidden" name="breastfeedingAsked" value="1" />
                <input type="checkbox" name="breastfeeding" checked={feeding} onChange={(e) => setFeeding(e.target.checked)} /> Breastfeeding
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">Prescriptions are checked against this: drugs to avoid in pregnancy or while breastfeeding are flagged.</p>
          </fieldset>
        )}
      </section>

      <section className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900 dark:text-white">{mode === "doctor" ? "Clinical notes" : "Triage"}</h2>
          {mode === "doctor" && (
            <select
              aria-label="Start from a template"
              value=""
              onChange={(e) => {
                const t = CASE_TEMPLATES.find((x) => x.label === e.target.value);
                if (t) applyTemplate(t);
              }}
              className={`${inputClass} w-auto py-1.5 text-xs`}
            >
              <option value="">Start from a template…</option>
              {CASE_TEMPLATES.map((t) => (
                <option key={t.label}>{t.label}</option>
              ))}
            </select>
          )}
        </div>
        <Field label="Chief complaint" error={err.chiefComplaint}>
          <textarea ref={complaint} name="chiefComplaint" rows={2} defaultValue={initial("chiefComplaint")} className={inputClass} />
        </Field>
        {mode === "doctor" && (
          <>
            <Field label="History" error={err.history}>
              <textarea ref={history} name="history" rows={4} defaultValue={initial("history")} className={inputClass} />
            </Field>
            <div className="space-y-1">
              <Field label="Examination" error={err.examination}>
                <textarea ref={exam} name="examination" rows={4} defaultValue={initial("examination")} className={inputClass} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {EXAM_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => insert(t.text)}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-brand-50 hover:text-brand-800 hover:ring-brand-600/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                  >
                    <Plus aria-hidden className="size-3" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Plan" error={err.plan}>
              <textarea ref={plan} name="plan" rows={3} defaultValue={initial("plan")} className={inputClass} />
            </Field>
            <Field label="Advice for the patient" error={err.patientAdvice} hint="In plain words: printed on the patient's visit summary">
              <textarea name="patientAdvice" rows={2} defaultValue={initial("patientAdvice")} placeholder="e.g. Drink plenty of fluids. Less salt. Come back in 2 weeks." className={inputClass} />
            </Field>
          </>
        )}
      </section>

      {/* Stays in reach while scrolling a long consultation. */}
      <div className="sticky bottom-0 z-10 -mx-1 space-y-2 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-raised backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        {/* Repeated here: the top of the form is usually scrolled out of view when these are pressed. */}
        {state.error && !pending && <Alert>{state.error}</Alert>}
        {state.ok && !pending && <Notice tone="success">Saved.</Notice>}
        <div className="flex flex-wrap items-start gap-2">
          <button type="submit" disabled={pending} className={steps.length ? secondaryButtonClass : buttonClass}>
            {pending && <LoaderCircle aria-hidden className="animate-spin" />}
            {pending ? "Saving…" : mode === "nurse" ? "Save triage" : "Save"}
          </button>
          {steps.map((s) => (
            <span key={s.to} className="inline-flex flex-col">
              <button
                type="submit"
                name="then"
                value={s.to}
                disabled={pending || !!s.blocked}
                aria-describedby={s.blocked ? `need-${s.to}` : undefined}
                className={s.primary && !s.blocked ? buttonClass : secondaryButtonClass}
              >
                {s.label}
              </button>
              {s.blocked && (
                <a id={`need-${s.to}`} href={s.blocked.anchor} className="mt-1 text-xs text-amber-700 hover:underline dark:text-amber-400">
                  {s.blocked.hint}
                </a>
              )}
            </span>
          ))}
        </div>
      </div>
    </form>
  );
}

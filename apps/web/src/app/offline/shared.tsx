"use client";

import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bmiFlag, suggestTriage, TRIAGE, type TriageLevel, vitalFlag } from "@/app/(app)/visits/[id]/vital-flags";
import { useT } from "@/components/lang-provider";
import { Badge, buttonClass, inputClass } from "@/components/ui";
import type { QueuePatient, VisitDetail } from "@/lib/api";
import { ageText, EN, etb } from "@/lib/format";
import type { T } from "@/lib/i18n";
import type { VisitFields } from "@/lib/offline/actions";
import { type ExpiredMarker, getExpired, getOff, getOps, getPatientIndex, getSnapshot, type OffMarker, purgeIfExpired } from "@/lib/offline/idb";
import type { Op, PatientIndex, Snapshot } from "@/lib/offline/types";
import { buildView, type OfflineVisit, type View } from "@/lib/offline/view";

/** The snapshot and queued work from this browser, re-read whenever either changes (any tab). */
export function useOfflineData() {
  const [data, setData] = useState<{ snap: Snapshot | null; ops: Op[]; index: PatientIndex | null; expired: ExpiredMarker | null; off: OffMarker | null; loaded: boolean }>({
    snap: null,
    ops: [],
    index: null,
    expired: null,
    off: null,
    loaded: false,
  });
  const load = useCallback(async () => {
    await purgeIfExpired().catch(() => false);
    const [snap, ops, index, expired, off] = await Promise.all([
      getSnapshot().catch(() => undefined),
      getOps().catch(() => [] as Op[]),
      getPatientIndex().catch(() => undefined),
      getExpired().catch(() => undefined),
      getOff().catch(() => undefined),
    ]);
    setData({ snap: snap ?? null, ops, index: index ?? null, expired: expired ?? null, off: off ?? null, loaded: true });
  }, []);
  useEffect(() => {
    // Reads IndexedDB (an external store) once mounted and whenever it changes.
    const first = window.setTimeout(() => void load(), 0);
    const onChange = () => void load();
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("hmis-offline");
      channel.onmessage = onChange;
    } catch {}
    window.addEventListener("hmis-offline-changed", onChange);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hmis-offline-changed", onChange);
      channel?.close();
    };
  }, [load]);
  // Rebuilt only when the stored data changes, not on every render.
  const view: View | null = useMemo(
    () => (data.snap ? buildView(data.snap, data.ops.filter((o) => o.userId === data.snap!.me.id), data.index) : null),
    [data],
  );
  return { ...data, view, reload: load };
}

export type TabProps = { view: View; userId: string };

export const fullName = (p: Pick<QueuePatient, "firstName" | "fatherName"> & { grandfather?: string | null }) =>
  [p.firstName, p.fatherName, p.grandfather].filter(Boolean).join(" ");

/** Name, card number, sex and age, allergies. `nameless` when the name is already the heading. */
export function PatientLine({ p, nameless = false }: { p: QueuePatient & { mrn: string }; nameless?: boolean }) {
  const t = useT();
  const age = ageText(p.dateOfBirth, true, t);
  return (
    <span className="min-w-0">
      {!nameless && <span className="mr-2 font-medium text-slate-900 dark:text-white">{fullName(p)}</span>}
      <span className="font-mono text-xs text-slate-500">{p.mrn === "New" ? t("new (number when sent)") : p.mrn}</span>
      <span className="ml-2 text-xs text-slate-500">
        {t(p.sex === "FEMALE" ? "F" : "M")}
        {age ? ` · ${age}` : ""}
      </span>
      {p.allergies?.length ? <span className="ml-2 text-xs font-medium text-red-700 dark:text-red-300">{t("Allergies: {list}", { list: p.allergies.join(", ") })}</span> : null}
    </span>
  );
}

export const money = (n: number | string, t: T = EN) => etb(n, t);

/** Waits for a queued action, keeping the button disabled meanwhile. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

const TRIAGE_ORDER: Record<string, number> = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
/** The order patients are seen in, as on the queue: emergencies first, then by arrival. */
export const byPriority = (a: OfflineVisit, b: OfflineVisit) =>
  (TRIAGE_ORDER[a.triageLevel ?? ""] ?? 3) - (TRIAGE_ORDER[b.triageLevel ?? ""] ?? 3) || a.checkedInAt.localeCompare(b.checkedInAt);

/** A small coloured dot with the triage level's name (for screen readers too). */
export function TriageDot({ level }: { level?: string | null }) {
  const t = useT();
  if (!level || !(level in TRIAGE)) return null;
  const x = TRIAGE[level as TriageLevel];
  return (
    <span className="inline-flex items-center" title={t(x.label)}>
      <span aria-hidden className={`inline-block size-2.5 rounded-full ${x.tone.split(" ")[0]}`} />
      <span className="sr-only">{t(x.label)}</span>
    </span>
  );
}

/** Seen before payment: triaged red (the API lets emergencies through unpaid). */
export const isEmergency = (v: Pick<OfflineVisit, "triageLevel">) => v.triageLevel === "RED";

const VITALS: { name: string; label: string; unit: string; min: number; max: number; int?: boolean }[] = [
  { name: "temperatureC", label: "Temp", unit: "°C", min: 25, max: 45 },
  { name: "pulse", label: "Pulse", unit: "/min", min: 20, max: 250, int: true },
  { name: "systolicBp", label: "BP systolic", unit: "mmHg", min: 50, max: 300, int: true },
  { name: "diastolicBp", label: "BP diastolic", unit: "mmHg", min: 20, max: 200, int: true },
  { name: "respRate", label: "Resp. rate", unit: "/min", min: 5, max: 80, int: true },
  { name: "spo2", label: "SpO₂", unit: "%", min: 50, max: 100, int: true },
  { name: "weightKg", label: "Weight", unit: "kg", min: 0.3, max: 300 },
  { name: "heightCm", label: "Height", unit: "cm", min: 20, max: 250 },
  { name: "muacMm", label: "MUAC", unit: "mm", min: 50, max: 400, int: true },
];
const NOTES = [
  ["chiefComplaint", "Chief complaint"],
  ["history", "History"],
  ["examination", "Examination"],
  ["plan", "Plan"],
  ["patientAdvice", "Advice for the patient"],
] as const;

/** Whole months from a date of birth to now (null when it isn't known). */
function monthsOld(dob: string | null) {
  if (!dob) return null;
  const a = new Date(dob);
  const b = new Date();
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0));
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Vitals, triage priority, pregnancy and notes, as on the visit page: the nurse records triage
 * (vitals, priority, chief complaint, pregnancy); the doctor everything. Shows the same flags as
 * online (unusual vitals for the patient's age, a suggested priority). Only changed fields are sent.
 */
export function VitalsForm({
  visit,
  detail,
  local,
  mode,
  busy,
  onSave,
}: {
  visit: OfflineVisit;
  detail?: Partial<VisitDetail>;
  local: VisitFields;
  mode: "nurse" | "doctor";
  busy: boolean;
  onSave: (fields: VisitFields) => void;
}) {
  const t = useT();
  const notes = mode === "nurse" ? NOTES.slice(0, 1) : NOTES;
  const keys = [...VITALS.map((v) => v.name), ...notes.map(([k]) => k), "triageLevel", "pregnancyStatus", "lmpDate", "breastfeeding"];
  // What is recorded so far (the server's, then this PC's): once saved, nothing counts as changed.
  const initial: Record<string, string> = useMemo(() => {
    const field = (k: string) => text(k in local ? local[k] : (detail as Record<string, unknown> | undefined)?.[k]);
    const all = [...VITALS.map((v) => v.name), ...NOTES.map(([k]) => k), "triageLevel", "pregnancyStatus", "lmpDate", "breastfeeding"];
    return Object.fromEntries(all.map((k) => [k, k === "lmpDate" ? field(k).slice(0, 10) : k === "triageLevel" ? field(k) || text(visit.triageLevel) : field(k)]));
  }, [local, detail, visit.triageLevel]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: string) => {
    setValues((was) => ({ ...was, [k]: v }));
    setSaved(false);
  };

  const ageMonths = monthsOld(visit.patient.dateOfBirth);
  const age = ageMonths === null ? null : Math.floor(ageMonths / 12);
  const canBePregnant = visit.patient.sex === "FEMALE" && (age === null || (age >= 10 && age <= 55));
  const ctx = { ageMonths, mother: values.pregnancyStatus === "PREGNANT" || values.pregnancyStatus === "POSSIBLE" || values.breastfeeding === "true" };
  const showMuac = (ageMonths !== null && ageMonths >= 6 && ageMonths < 60) || canBePregnant;
  const vitals = Object.fromEntries(VITALS.map((v) => [v.name, values[v.name]]));
  const suggestion = suggestTriage(vitals, ctx);
  const bmi = Number(values.weightKg) > 0 && Number(values.heightCm) > 0 ? Number(values.weightKg) / (Number(values.heightCm) / 100) ** 2 : null;

  // What changed, as the API takes it; and what is wrong with it.
  const errors: Record<string, string> = {};
  const changed: VisitFields = {};
  for (const k of keys) {
    const v = values[k] ?? "";
    if (v === (initial[k] ?? "")) continue;
    const vital = VITALS.find((x) => x.name === k);
    if (vital) {
      if (v.trim() === "") {
        changed[k] = null;
        continue;
      }
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < vital.min || n > vital.max) errors[k] = t("Between {min} and {max}", { min: vital.min, max: vital.max });
      else changed[k] = vital.int ? Math.round(n) : n;
    } else if (k === "breastfeeding") changed[k] = v === "true";
    else changed[k] = v.trim() === "" ? null : v.trim();
  }
  const sys = Number(values.systolicBp);
  const dia = Number(values.diastolicBp);
  if (values.systolicBp && values.diastolicBp && sys <= dia) errors.diastolicBp = t("Systolic must be higher than diastolic");
  if (values.pregnancyStatus === "PREGNANT" && values.lmpDate) {
    // Counted to the visit's day (the server counts to the day it is sent: the same day, or close).
    const days = (Date.parse(visit.checkedInAt) - Date.parse(`${values.lmpDate}T12:00:00Z`)) / 86_400_000;
    if (!(days >= 0 && days <= 300)) errors.lmpDate = t("The last period must be within the last 10 months");
  }
  // A last period only goes with a pregnancy.
  if (values.pregnancyStatus !== "PREGNANT" && "lmpDate" in changed) delete changed.lmpDate;
  const invalid = Object.keys(errors).length > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {VITALS.filter((f) => f.name !== "muacMm" || showMuac).map((f) => {
          const flag = vitalFlag(f.name, values[f.name] ?? "", ctx);
          const error = errors[f.name];
          return (
            <label key={f.name} className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-500">
                {t(f.label)} ({f.unit})
              </span>
              <input
                inputMode="decimal"
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.target.value)}
                aria-invalid={error ? true : undefined}
                className={`${inputClass} ${error || flag?.urgent ? "border-red-400! dark:border-red-700!" : flag ? "border-amber-400! dark:border-amber-700!" : ""}`}
              />
              {error ? (
                <span className="block text-xs font-medium text-red-700 dark:text-red-300">{error}</span>
              ) : flag ? (
                <span className={`flex items-center gap-1 text-xs font-medium ${flag.urgent ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  {t(flag.text)}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      {bmi && Number.isFinite(bmi) && (
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">BMI {bmi.toFixed(1)} kg/m²</Badge>
          {age !== null && age >= 18 && bmiFlag(bmi) && <Badge tone={bmiFlag(bmi)!.urgent ? "danger" : "warning"}>{t(bmiFlag(bmi)!.text)}</Badge>}
        </p>
      )}

      <fieldset className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <legend className="text-sm font-medium">{t("Triage priority")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(TRIAGE) as TriageLevel[]).map((l) => (
            <label
              key={l}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ${
                values.triageLevel === l ? `${TRIAGE[l].tone} ring-transparent` : "ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800"
              }`}
            >
              <input type="radio" name={`triage-${visit.id}`} value={l} checked={values.triageLevel === l} onChange={() => set("triageLevel", l)} className="sr-only" />
              <span aria-hidden className={`inline-block size-2.5 rounded-full ${TRIAGE[l].tone.split(" ")[0]} ${values.triageLevel === l ? "ring-2 ring-white" : ""}`} />
              <span className="font-medium">{t(TRIAGE[l].label)}</span>
              <span className={`text-xs ${values.triageLevel === l ? "opacity-90" : "text-slate-500"}`}>{t(TRIAGE[l].hint)}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {t.rich("Suggested from the vitals: {level}", { level: <span className="font-medium">{t(TRIAGE[suggestion.level].label)}</span> })}
          {suggestion.because && ` (${t.lang === "am" ? t(suggestion.because) : suggestion.because.toLowerCase()})`}. {t("Look at the patient too: danger signs the vitals don't show come first.")}
        </p>
      </fieldset>

      {canBePregnant && (
        <fieldset className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <legend className="text-sm font-medium">{t("Pregnancy and breastfeeding")}</legend>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-500">{t("Could she be pregnant?")}</span>
              <select value={values.pregnancyStatus} onChange={(e) => set("pregnancyStatus", e.target.value)} className={`${inputClass} block w-auto`}>
                <option value="">{t("Not asked")}</option>
                <option value="NOT_PREGNANT">{t("Not pregnant")}</option>
                <option value="POSSIBLE">{t("Possibly (test pending)")}</option>
                <option value="PREGNANT">{t("Pregnant")}</option>
              </select>
            </label>
            {values.pregnancyStatus === "PREGNANT" && (
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-medium text-slate-500">{t("First day of last period")}</span>
                <input type="date" value={values.lmpDate} onChange={(e) => set("lmpDate", e.target.value)} className={`${inputClass} block w-auto`} />
                {errors.lmpDate && <span className="block text-xs font-medium text-red-700 dark:text-red-300">{errors.lmpDate}</span>}
              </label>
            )}
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={values.breastfeeding === "true"} onChange={(e) => set("breastfeeding", e.target.checked ? "true" : "false")} /> {t("Breastfeeding")}
            </label>
          </div>
        </fieldset>
      )}

      <div className={`grid gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 ${mode === "doctor" ? "sm:grid-cols-2" : ""}`}>
        {notes.map(([k, label]) => (
          <label key={k} className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-slate-500">{t(label)}</span>
            <textarea rows={mode === "nurse" ? 2 : 3} value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={inputClass} />
          </label>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-emerald-700 dark:text-emerald-400">{t("Saved on this PC")}</span>}
        <button
          disabled={busy || invalid || !Object.keys(changed).length}
          onClick={() => {
            onSave(changed);
            setSaved(true);
          }}
          className={buttonClass}
        >
          {t(mode === "nurse" ? "Save triage" : "Save notes")}
        </button>
      </div>
    </div>
  );
}

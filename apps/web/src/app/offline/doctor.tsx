"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Badge, buttonClass, Card, EmptyState, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { DrugOption, Frequency, IcdEntry, VisitStatus } from "@/lib/api";
import { addDiagnosis, orderLab, prescribe, type RxLine, saveNotes, setStatus } from "@/lib/offline/actions";
import type { OfflineVisit } from "@/lib/offline/view";
import { fullName, type TabProps, useBusy } from "./shared";

const VITALS = [
  ["temperatureC", "Temp °C"],
  ["pulse", "Pulse"],
  ["systolicBp", "BP systolic"],
  ["diastolicBp", "BP diastolic"],
  ["respRate", "Resp. rate"],
  ["spo2", "SpO₂ %"],
  ["weightKg", "Weight kg"],
] as const;
const NOTES = [
  ["chiefComplaint", "Chief complaint"],
  ["history", "History"],
  ["examination", "Examination"],
  ["plan", "Plan"],
] as const;
const INTEGER = new Set(["pulse", "systolicBp", "diastolicBp", "respRate", "spo2"]);
const FREQUENCIES: Frequency[] = ["OD", "BID", "TID", "QID", "NOCTE", "PRN", "STAT"];

export function Doctor({ view, userId }: TabProps) {
  const open = view.queue.filter((v) => v.status !== "COMPLETED" && v.status !== "CANCELLED");
  const [selected, setSelected] = useState<string | null>(null);
  const visit = open.find((v) => v.id === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <Card title="Patients today">
        <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {open.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => setSelected(v.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm ${v.id === selected ? "bg-brand-50 dark:bg-brand-950/60" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
              >
                <span className="min-w-0 truncate">
                  <span className="mr-2 font-mono text-slate-500 tabular-nums">{v.offline ? "·" : v.queueNumber}</span>
                  {fullName(v.patient)}
                </span>
                <StatusBadge status={v.status} />
              </button>
            </li>
          ))}
          {!open.length && <li className="py-3 text-sm text-slate-500">No open visits on this PC.</li>}
        </ul>
      </Card>
      {visit ? <Consultation key={visit.id} view={view} userId={userId} visit={visit} /> : <EmptyState title="Choose a patient" />}
    </div>
  );
}

function Consultation({ view, userId, visit }: TabProps & { visit: OfflineVisit }) {
  const detail = view.snap.visits[visit.id];
  const local = view.notes[visit.id] ?? {};
  const [busy, run] = useBusy();
  const waiting = visit.status === "WAITING";
  const diagnoses = [...(detail?.diagnoses.map((d) => ({ code: d.icd11Code, label: d.label })) ?? []), ...(view.diagnoses[visit.id] ?? [])];
  const diagnosed = diagnoses.length > 0 || Boolean(visit.diagnosed);
  const unpaid = view.snap.prepayment && visit.consultationPaid === false;
  // Ordered before this PC went offline (from the snapshot): shown, and not ordered twice.
  const earlierTests = new Set((detail?.labOrders ?? []).filter((o) => o.status !== "CANCELLED").map((o) => o.labTest.id));
  const earlierDrugs = (detail?.prescriptions ?? []).filter((p) => p.status !== "CANCELLED").flatMap((p) => p.items.map((i) => i.drug));

  const move = (status: VisitStatus) => run(() => setStatus(userId, visit, status));

  return (
    <div className="space-y-6">
      <section className="surface flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{fullName(visit.patient)}</h2>
          <p className="text-sm text-slate-500">
            {visit.patient.sex === "FEMALE" ? "Female" : "Male"}
            {visit.patient.allergies?.length ? <span className="ml-2 font-medium text-red-700 dark:text-red-300">Allergies: {visit.patient.allergies.join(", ")}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {waiting && (
            <button disabled={busy || unpaid} onClick={() => move("IN_CONSULTATION")} className={buttonClass} title={unpaid ? "The consultation fee is not paid yet" : undefined}>
              Call in
            </button>
          )}
          {!waiting && (
            <>
              <button disabled={busy} onClick={() => move("AWAITING_LAB")} className={secondaryButtonClass}>
                Send to lab
              </button>
              <button disabled={busy || !diagnosed} onClick={() => move("AWAITING_PHARMACY")} className={secondaryButtonClass} title={diagnosed ? undefined : "Add a diagnosis first"}>
                Send to pharmacy
              </button>
              <button disabled={busy || !diagnosed} onClick={() => move("COMPLETED")} className={buttonClass} title={diagnosed ? undefined : "Add a diagnosis first"}>
                Complete
              </button>
            </>
          )}
        </div>
      </section>
      {waiting && <Notice tone="info">{unpaid ? "The consultation fee has not been paid yet (as far as this PC knows)." : "Call the patient in to record notes and orders."}</Notice>}

      {!waiting && (
        <>
          <NotesCard
            initial={Object.fromEntries([...VITALS, ...NOTES].map(([k]) => [k, String(local[k] ?? detail?.[k as keyof typeof detail] ?? "")]))}
            busy={busy}
            onSave={(fields) => run(() => saveNotes(userId, visit, fields))}
          />
          <DiagnosisCard icd={view.snap.icd} diagnoses={diagnoses} busy={busy} onAdd={(icd, primary) => run(() => addDiagnosis(userId, visit, icd, primary))} />
          <LabCard view={view} visit={visit} earlier={earlierTests} busy={busy} onOrder={(tests) => run(() => orderLab(userId, visit, tests))} />
          <RxCard
            drugs={view.snap.drugs}
            earlier={[...earlierDrugs, ...view.pharmacy.filter((rx) => rx.visit.id === visit.id).flatMap((rx) => rx.items.map((i) => i.drug))]}
            busy={busy}
            onPrescribe={(lines) => run(() => prescribe(userId, visit, lines))}
          />
        </>
      )}
    </div>
  );
}

function NotesCard({ initial, busy, onSave }: { initial: Record<string, string>; busy: boolean; onSave: (fields: Record<string, string | number>) => void }) {
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(false);
  const changed = Object.fromEntries(
    Object.entries(values)
      .filter(([k, v]) => v.trim() !== "" && v !== initial[k])
      .map(([k, v]) => [k, NOTES.some(([n]) => n === k) ? v.trim() : INTEGER.has(k) ? Math.round(Number(v)) : Number(v)]),
  );
  const invalid = Object.entries(changed).some(([, v]) => typeof v === "number" && !Number.isFinite(v));
  return (
    <Card title="Vitals and notes">
      <div className="grid gap-3 sm:grid-cols-4">
        {VITALS.map(([k, label]) => (
          <label key={k} className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-slate-500">{label}</span>
            <input inputMode="decimal" value={values[k]} onChange={(e) => (setValues({ ...values, [k]: e.target.value }), setSaved(false))} className={inputClass} />
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {NOTES.map(([k, label]) => (
          <label key={k} className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-slate-500">{label}</span>
            <textarea rows={3} value={values[k]} onChange={(e) => (setValues({ ...values, [k]: e.target.value }), setSaved(false))} className={inputClass} />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved on this PC</span>}
        <button
          disabled={busy || invalid || !Object.keys(changed).length}
          onClick={() => {
            onSave(changed);
            setSaved(true);
          }}
          className={buttonClass}
        >
          Save notes
        </button>
      </div>
    </Card>
  );
}

function DiagnosisCard({ icd, diagnoses, busy, onAdd }: { icd: IcdEntry[]; diagnoses: { code: string; label: string }[]; busy: boolean; onAdd: (icd: IcdEntry, primary: boolean) => void }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return icd.filter((d) => words.every((w) => `${d.code} ${d.label} ${d.labelAm ?? ""}`.toLowerCase().includes(w))).slice(0, 8);
  }, [q, icd]);
  return (
    <Card title="Diagnosis" description="Common ICD-11 diagnoses kept on this PC. For others, add them when the connection is back.">
      {diagnoses.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {diagnoses.map((d, i) => (
            <li key={`${d.code}-${i}`}>
              <Badge tone="brand">
                {d.code} · {d.label}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: malaria, pneumonia, CA40…" className={inputClass} />
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {matches.map((d) => (
          <li key={d.code} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="font-mono text-slate-500">{d.code}</span> {d.label}
            </span>
            <button
              disabled={busy}
              onClick={() => {
                onAdd(d, diagnoses.length === 0);
                setQ("");
              }}
              className={`${secondaryButtonClass} btn-size`}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LabCard({
  view,
  visit,
  earlier,
  busy,
  onOrder,
}: {
  view: TabProps["view"];
  visit: OfflineVisit;
  earlier: Set<string>;
  busy: boolean;
  onOrder: (tests: TabProps["view"]["snap"]["labTests"]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const ordered = new Set([...earlier, ...view.lab.filter((o) => o.visit.id === visit.id && o.status !== "CANCELLED").map((o) => o.labTest.id)]);
  return (
    <Card title="Lab tests">
      <div className="grid gap-2 sm:grid-cols-3">
        {view.snap.labTests.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={ordered.has(t.id)}
              checked={ordered.has(t.id) || chosen.includes(t.id)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, t.id] : chosen.filter((x) => x !== t.id))}
            />
            {t.name}
            <span className="text-xs text-slate-500">{Number(t.price).toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          disabled={busy || !chosen.length}
          onClick={() => {
            onOrder(view.snap.labTests.filter((t) => chosen.includes(t.id)));
            setChosen([]);
          }}
          className={buttonClass}
        >
          Order {chosen.length || ""} {chosen.length === 1 ? "test" : "tests"}
        </button>
      </div>
    </Card>
  );
}

function RxCard({ drugs, earlier, busy, onPrescribe }: { drugs: DrugOption[]; earlier: Pick<DrugOption, "id" | "genericName">[]; busy: boolean; onPrescribe: (lines: RxLine[]) => void }) {
  const [lines, setLines] = useState<RxLine[]>([]);
  const [drugId, setDrugId] = useState("");
  const [dose, setDose] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("TID");
  const [days, setDays] = useState("");
  const [quantity, setQuantity] = useState("");
  const drug = drugs.find((d) => d.id === drugId);
  const already = new Set(earlier.map((d) => d.id));
  const canAdd =
    drug && dose.trim() && /^\d+$/.test(quantity) && Number(quantity) > 0 && (days === "" || /^\d+$/.test(days)) && !lines.some((l) => l.drug.id === drugId) && !already.has(drugId);
  return (
    <Card title="Prescription" description="Allergy and interaction checks run when this reaches the server; an alert brings it back to you.">
      {earlier.length > 0 && (
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Already prescribed this visit: {[...new Set(earlier.map((d) => d.genericName))].join(", ")}.</p>
      )}
      {lines.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100 dark:divide-slate-800">
          {lines.map((l) => (
            <li key={l.drug.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{l.drug.genericName}</span> {l.drug.strength} · {l.dose} {l.frequency}
                {l.durationDays ? ` × ${l.durationDays} days` : ""} · {l.quantity} {l.drug.unit}
              </span>
              <button aria-label="Remove" onClick={() => setLines(lines.filter((x) => x !== l))} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-6">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block text-xs font-medium text-slate-500">Drug</span>
          <select value={drugId} onChange={(e) => setDrugId(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {drugs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.genericName} {d.strength ?? ""} {d.form} ({d.inStock} in stock)
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">Dose</span>
          <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="500 mg" className={inputClass} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">How often</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className={inputClass}>
            {FREQUENCIES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">Days</span>
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">Quantity</span>
          <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
        </label>
      </div>
      {drug && Number(quantity) > drug.inStock && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Only {drug.inStock} in stock when this PC last checked.</p>}
      {drug && already.has(drug.id) && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{drug.genericName} is already prescribed for this visit.</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          disabled={!canAdd}
          onClick={() => {
            setLines([...lines, { drug: drug!, dose: dose.trim(), frequency, durationDays: days ? Number(days) : undefined, quantity: Number(quantity) }]);
            setDrugId("");
            setDose("");
            setDays("");
            setQuantity("");
          }}
          className={secondaryButtonClass}
        >
          <Plus aria-hidden className="size-4" /> Add drug
        </button>
        <button
          disabled={busy || !lines.length}
          onClick={() => {
            onPrescribe(lines);
            setLines([]);
          }}
          className={buttonClass}
        >
          Prescribe
        </button>
      </div>
    </Card>
  );
}

"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { useT } from "@/components/lang-provider";
import { Badge, buttonClass, Card, EmptyState, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { DrugOption, Frequency, IcdEntry, LabOrder, VisitStatus } from "@/lib/api";
import { addDiagnosis, orderLab, prescribe, type RxLine, saveNotes, setStatus } from "@/lib/offline/actions";
import type { OfflineVisit } from "@/lib/offline/view";
import { byPriority, fullName, isEmergency, PatientLine, type TabProps, TriageDot, useBusy, VitalsForm } from "./shared";

const FREQUENCIES: Frequency[] = ["OD", "BID", "TID", "QID", "NOCTE", "PRN", "STAT"];
/** The API's check of a code typed by hand (consultation.controller.ts). */
const ICD11_CODE = /^[0-9A-HJ-NP-Z]{4}(\.[0-9A-HJ-NP-Z]{1,2})?(&[0-9A-Z.&/]+)?$/;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Addis_Ababa" });

export function Doctor({ view, userId }: TabProps) {
  const open = view.queue.filter((v) => v.status !== "COMPLETED" && v.status !== "CANCELLED").sort(byPriority);
  const [selected, setSelected] = useState<string | null>(null);
  const visit = open.find((v) => v.id === selected) ?? null;
  const t = useT();

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <Card title={t("Patients today")}>
        <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {open.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => setSelected(v.id)}
                aria-current={v.id === selected ? "true" : undefined}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm ${v.id === selected ? "bg-brand-50 dark:bg-brand-950/60" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-6 shrink-0 font-mono text-slate-500 tabular-nums">{v.offline ? "·" : v.queueNumber}</span>
                  <TriageDot level={v.triageLevel} />
                  <span className="truncate">{fullName(v.patient)}</span>
                </span>
                <StatusBadge status={v.status} lang={t.lang} />
              </button>
            </li>
          ))}
          {!open.length && <li className="py-3 text-sm text-slate-500">{t("No open visits on this PC.")}</li>}
        </ul>
      </Card>
      {visit ? <Consultation key={visit.id} view={view} userId={userId} visit={visit} /> : <EmptyState title={t("Choose a patient")} />}
    </div>
  );
}

function Consultation({ view, userId, visit }: TabProps & { visit: OfflineVisit }) {
  const detail = view.snap.visits[visit.id];
  const [busy, run] = useBusy();
  const t = useT();
  const waiting = visit.status === "WAITING";
  const diagnoses = [...(detail?.diagnoses.map((d) => ({ code: d.icd11Code, label: d.label })) ?? []), ...(view.diagnoses[visit.id] ?? [])];
  const diagnosed = diagnoses.length > 0 || Boolean(visit.diagnosed);
  // Pay first, except emergencies (triaged red), as on the server.
  const unpaid = view.snap.prepayment && visit.consultationPaid === false;
  const blocked = unpaid && !isEmergency(visit);
  // Ordered before this PC went offline (from the snapshot): shown, and not ordered twice.
  const earlierTests = new Set((detail?.labOrders ?? []).filter((o) => o.status !== "CANCELLED").map((o) => o.labTest.id));
  const earlierDrugs = (detail?.prescriptions ?? []).filter((p) => p.status !== "CANCELLED").flatMap((p) => p.items.map((i) => i.drug));
  const tests: LabOrder[] = [...(detail?.labOrders ?? []), ...view.lab.filter((o) => o.visit.id === visit.id)].filter((o) => o.status !== "CANCELLED");

  const move = (status: VisitStatus) => run(() => setStatus(userId, visit, status));

  return (
    <div className="space-y-6">
      <section className="surface flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <TriageDot level={visit.triageLevel} /> {fullName(visit.patient)}
          </h2>
          <PatientLine p={visit.patient} nameless />
        </div>
        <div className="flex flex-wrap gap-2">
          {waiting && (
            <button disabled={busy || blocked} onClick={() => move("IN_CONSULTATION")} className={buttonClass} title={blocked ? t("The consultation fee is not paid yet") : undefined}>
              {t("Call in")}
            </button>
          )}
          {!waiting && (
            <>
              <button disabled={busy} onClick={() => move("AWAITING_LAB")} className={secondaryButtonClass}>
                {t("Send to lab")}
              </button>
              <button
                disabled={busy || !diagnosed}
                onClick={() => move("AWAITING_PHARMACY")}
                className={secondaryButtonClass}
                title={diagnosed ? undefined : t("Add a diagnosis first")}
              >
                {t("Send to pharmacy")}
              </button>
              <button disabled={busy || !diagnosed} onClick={() => move("COMPLETED")} className={buttonClass} title={diagnosed ? undefined : t("Add a diagnosis first")}>
                {t("Complete")}
              </button>
            </>
          )}
        </div>
      </section>
      {waiting && (
        <Notice tone={blocked ? "warning" : "info"}>
          {t(
            blocked
              ? "The consultation fee has not been paid yet (as far as this PC knows)."
              : unpaid
                ? "An emergency: seen before payment. The fee stays owed."
                : "Call the patient in to record notes and orders.",
          )}
        </Notice>
      )}

      {!waiting && (
        <>
          <Card title={t("Vitals and notes")}>
            <VitalsForm
              visit={visit}
              detail={detail}
              local={view.notes[visit.id] ?? {}}
              mode="doctor"
              busy={busy}
              onSave={(fields) => run(() => saveNotes(userId, visit, fields))}
            />
          </Card>
          <DiagnosisCard icd={view.snap.icd} diagnoses={diagnoses} busy={busy} onAdd={(icd, primary) => run(() => addDiagnosis(userId, visit, icd, primary))} />
          {tests.length > 0 && <ResultsCard tests={tests} />}
          <LabCard view={view} visit={visit} earlier={earlierTests} busy={busy} onOrder={(chosen) => run(() => orderLab(userId, visit, chosen))} />
          <RxCard
            drugs={view.snap.drugs}
            earlier={[...earlierDrugs, ...view.pharmacy.filter((rx) => rx.visit.id === visit.id).flatMap((rx) => rx.items.map((i) => i.drug))]}
            busy={busy}
            onPrescribe={(lines) => run(() => prescribe(userId, visit, lines))}
          />
        </>
      )}
      {detail?.previous?.length ? <HistoryCard previous={detail.previous} /> : null}
    </div>
  );
}

/** The patient's earlier visits here (from the snapshot), for context. */
function HistoryCard({ previous }: { previous: NonNullable<TabProps["view"]["snap"]["visits"][string]["previous"]> }) {
  const t = useT();
  return (
    <Card title={t("Previous visits")}>
      <ul className="-my-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {previous.map((p) => (
          <li key={p.id} className="py-2.5">
            <p className="font-medium text-slate-900 dark:text-white">
              {day(p.checkedInAt)}
              {p.doctor && <span className="ml-2 font-normal text-slate-500">{p.doctor.fullName}</span>}
            </p>
            {p.diagnoses.length > 0 && <p className="text-slate-700 dark:text-slate-300">{p.diagnoses.map((d) => `${d.icd11Code} ${d.label}`).join("; ")}</p>}
            {p.chiefComplaint && <p className="text-slate-600 dark:text-slate-400">{p.chiefComplaint}</p>}
            {(p.systolicBp || p.weightKg) && (
              <p className="text-xs text-slate-500">
                {p.systolicBp ? `BP ${p.systolicBp}/${p.diastolicBp ?? "?"}` : ""}
                {p.systolicBp && p.weightKg ? " · " : ""}
                {p.weightKg ? `${p.weightKg} kg` : ""}
              </p>
            )}
            {p.prescriptions.some((rx) => rx.items.length) && (
              <p className="text-xs text-slate-500">
                {p.prescriptions
                  .flatMap((rx) => rx.items)
                  .map((i) => `${i.drug.genericName} ${i.drug.strength ?? ""} ${i.dose} ${i.frequency}`.replace(/\s+/g, " ").trim())
                  .join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const FLAG_TONE: Record<string, string> = { HH: "text-red-700 dark:text-red-300", LL: "text-red-700 dark:text-red-300", H: "text-amber-700 dark:text-amber-300", L: "text-amber-700 dark:text-amber-300" };

/** Tests of this visit and their released results (as of the last snapshot, or released on this PC). */
function ResultsCard({ tests }: { tests: LabOrder[] }) {
  const t = useT();
  return (
    <Card title={t("Lab results")} description={t("As this PC last had them; results released on the lab's PC show here after it has sent them.")}>
      <ul className="-my-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {tests.map((o) => (
          <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
            <span className="font-medium text-slate-900 dark:text-white">{o.labTest.name}</span>
            {o.status === "VERIFIED" ? (
              o.values?.length && o.labTest.components?.length ? (
                <span className="text-slate-700 dark:text-slate-300">
                  {o.values.map((v, i) => {
                    const c = o.labTest.components!.find((x) => x.id === v.componentId);
                    return (
                      <span key={v.componentId} className={v.flag ? FLAG_TONE[v.flag] : undefined}>
                        {i > 0 && "; "}
                        {c?.name} {v.value}
                        {c?.unit ? ` ${c.unit}` : ""}
                        {v.flag && v.flag !== "N" ? ` ${v.flag}` : ""}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className={`tabular-nums ${o.resultFlag ? (FLAG_TONE[o.resultFlag] ?? "") : ""}`}>
                  {o.resultValue} {o.labTest.unit ?? ""}
                  {o.resultFlag && o.resultFlag !== "N" ? ` ${o.resultFlag}` : ""}
                  {o.critical && <Badge tone="danger">{t("Critical")}</Badge>}
                </span>
              )
            ) : (
              <span className="text-slate-500">{t(o.status === "ORDERED" ? "Sample to take" : "In the lab")}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DiagnosisCard({ icd, diagnoses, busy, onAdd }: { icd: IcdEntry[]; diagnoses: { code: string; label: string }[]; busy: boolean; onAdd: (icd: IcdEntry, primary: boolean) => void }) {
  const [q, setQ] = useState("");
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const t = useT();
  const has = new Set(diagnoses.map((d) => d.code));
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return icd.filter((d) => words.every((w) => `${d.code} ${d.label} ${d.labelAm ?? ""}`.toLowerCase().includes(w))).slice(0, 8);
  }, [q, icd]);
  const typed = code.trim().toUpperCase();
  const codeOk = ICD11_CODE.test(typed);
  const add = (d: IcdEntry) => {
    onAdd(d, diagnoses.length === 0);
    setQ("");
    setCode("");
    setLabel("");
    setManual(false);
  };
  return (
    <Card title={t("Diagnosis")} description={t("Common ICD-11 diagnoses kept on this PC; any other by its ICD-11 code.")}>
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
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search: malaria, pneumonia, CA40…")} className={inputClass} />
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {matches.map((d) => (
          <li key={d.code} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="font-mono text-slate-500">{d.code}</span> {t.lang === "am" && d.labelAm ? d.labelAm : d.label}
            </span>
            {has.has(d.code) ? (
              <Badge tone="neutral">{t("Added")}</Badge>
            ) : (
              <button disabled={busy} onClick={() => add(d)} className={`${secondaryButtonClass} btn-size`}>
                {t("Add")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {q.trim().length >= 2 && matches.length === 0 && <p className="mt-2 text-xs text-slate-500">{t("Not in the common list.")}</p>}
      {manual ? (
        <form
          className="mt-3 flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeOk && label.trim().length >= 2 && !has.has(typed)) add({ code: typed, label: label.trim() });
          }}
        >
          <label className="w-36">
            <span className="sr-only">{t("ICD-11 code")}</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("ICD-11 code")} className={`${inputClass} font-mono`} aria-invalid={code && !codeOk ? true : undefined} />
          </label>
          <label className="min-w-48 flex-1">
            <span className="sr-only">{t("Diagnosis")}</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Diagnosis")} className={inputClass} />
          </label>
          <button className={secondaryButtonClass} disabled={busy || !codeOk || label.trim().length < 2 || has.has(typed)}>
            {t("Add")}
          </button>
          {code.trim() && !codeOk && <p className="w-full text-xs text-red-700 dark:text-red-300">{t("Not a valid ICD-11 code (for example CA40 or ME84.2)")}</p>}
          {has.has(typed) && <p className="w-full text-xs text-amber-700 dark:text-amber-300">{t("This diagnosis is already recorded for the visit")}</p>}
        </form>
      ) : (
        <button type="button" onClick={() => setManual(true)} className="mt-3 text-xs text-brand-700 hover:underline dark:text-brand-400">
          {t("Enter an ICD-11 code by hand")}
        </button>
      )}
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
  const t = useT();
  const ordered = new Set([...earlier, ...view.lab.filter((o) => o.visit.id === visit.id && o.status !== "CANCELLED").map((o) => o.labTest.id)]);
  return (
    <Card title={t("Lab tests")}>
      <div className="grid gap-2 sm:grid-cols-3">
        {view.snap.labTests.map((x) => (
          <label key={x.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={ordered.has(x.id)}
              checked={ordered.has(x.id) || chosen.includes(x.id)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, x.id] : chosen.filter((y) => y !== x.id))}
            />
            {x.name}
            <span className="text-xs text-slate-500">{Number(x.price).toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          disabled={busy || !chosen.length}
          onClick={() => {
            onOrder(view.snap.labTests.filter((x) => chosen.includes(x.id)));
            setChosen([]);
          }}
          className={buttonClass}
        >
          {chosen.length ? t(chosen.length === 1 ? "Order {n} test" : "Order {n} tests", { n: chosen.length }) : t("Order tests")}
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
  const t = useT();
  const drug = drugs.find((d) => d.id === drugId);
  const already = new Set(earlier.map((d) => d.id));
  const canAdd =
    drug && dose.trim() && /^\d+$/.test(quantity) && Number(quantity) > 0 && (days === "" || /^\d+$/.test(days)) && !lines.some((l) => l.drug.id === drugId) && !already.has(drugId);
  return (
    <Card title={t("Prescription")} description={t("Allergy and interaction checks run when this reaches the server; an alert brings it back to you.")}>
      {earlier.length > 0 && (
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          {t("Already prescribed this visit: {drugs}.", { drugs: [...new Set(earlier.map((d) => d.genericName))].join(", ") })}
        </p>
      )}
      {lines.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100 dark:divide-slate-800">
          {lines.map((l) => (
            <li key={l.drug.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{l.drug.genericName}</span> {l.drug.strength} · {l.dose} {l.frequency}
                {l.durationDays ? ` × ${t("{n} days", { n: l.durationDays })}` : ""} · {l.quantity} {l.drug.unit}
              </span>
              <button aria-label={t("Remove")} onClick={() => setLines(lines.filter((x) => x !== l))} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-6">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block text-xs font-medium text-slate-500">{t("Drug")}</span>
          <select value={drugId} onChange={(e) => setDrugId(e.target.value)} className={inputClass}>
            <option value="">{t("Choose…")}</option>
            {drugs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.genericName} {d.strength ?? ""} {d.form} ({t("{n} in stock", { n: d.inStock })})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">{t("Dose")}</span>
          <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="500 mg" className={inputClass} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">{t("How often")}</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className={inputClass}>
            {FREQUENCIES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">{t("Days")}</span>
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">{t("Quantity")}</span>
          <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
        </label>
      </div>
      {drug && Number(quantity) > drug.inStock && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{t("Only {n} in stock when this PC last checked.", { n: drug.inStock })}</p>}
      {drug && already.has(drug.id) && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{t("{drug} is already prescribed for this visit.", { drug: drug.genericName })}</p>}
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
          <Plus aria-hidden className="size-4" /> {t("Add drug")}
        </button>
        <button
          disabled={busy || !lines.length}
          onClick={() => {
            onPrescribe(lines);
            setLines([]);
          }}
          className={buttonClass}
        >
          {t("Prescribe")}
        </button>
      </div>
    </Card>
  );
}

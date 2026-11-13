import { CalendarPlus, Clock, History, ListOrdered, Pill, UserRound, FileText } from "lucide-react";
import { shortDirections } from "@/lib/directions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { moveVisit } from "@/app/actions";
import { AllergyAlert } from "@/components/allergy-alert";
import { AllergyEditor } from "@/components/allergy-editor";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass, Notice, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { Flash } from "@/components/flash";
import { api, ApiError, type ClinicalDocument, type LabHistoryOrder, type PatientProblem, type VitalsRow, type LabOrder, type LabTest, type Me, type Prescription, type ProcedureCharge, type Service, type VisitDetail } from "@/lib/api";
import { ageFrom, etb, formatDualDate, formatDuration, formatTime, fullName } from "@/lib/format";
import { ConsultationForm } from "./consultation-form";
import { Addenda } from "@/components/addenda";
import { NotifiablePanel } from "@/components/notifiable-panel";
import { ProblemList } from "@/components/problem-list";
import { VitalsTrend } from "@/components/vitals-trend";
import { DiagnosisPanel } from "./diagnosis-panel";
import { LabPanel } from "./lab-panel";
import { PrescriptionPanel } from "./prescription-panel";
import { DocumentsPanel } from "./documents-panel";
import { ProceduresPanel } from "./procedures-panel";

const VITAL_LABELS: [keyof VisitDetail, string, string][] = [
  ["temperatureC", "Temp", "°C"],
  ["pulse", "Pulse", "/min"],
  ["respRate", "RR", "/min"],
  ["spo2", "SpO₂", "%"],
  ["weightKg", "Weight", "kg"],
  ["heightCm", "Height", "cm"],
];

function ReadOnly({ v }: { v: VisitDetail }) {
  const vitals = VITAL_LABELS.filter(([k]) => v[k] !== null).map(([k, label, unit]) => `${label} ${v[k]}${unit}`);
  if (v.systolicBp && v.diastolicBp) vitals.splice(1, 0, `BP ${v.systolicBp}/${v.diastolicBp}`);
  const notes: [string, string | null][] = [
    ["Chief complaint", v.chiefComplaint],
    ["History", v.history],
    ["Examination", v.examination],
    ["Plan", v.plan],
    ["Advice for the patient", v.patientAdvice],
  ];
  return (
    <div className="space-y-4 text-sm">
      <p>
        <span className="font-medium">Vitals: </span>
        {vitals.length ? vitals.join(" · ") : <span className="text-slate-500">not recorded</span>}
      </p>
      {notes.map(([label, text]) => (
        <div key={label}>
          <h3 className="font-medium">{label}</h3>
          <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{text || <span className="text-slate-500">—</span>}</p>
        </div>
      ))}
    </div>
  );
}

async function Visit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  const me = await api<Me>("/auth/me");
  let v: VisitDetail;
  let prescriptions: Prescription[];
  let labOrders: LabOrder[];
  let labTests: LabTest[];
  let procedures: ProcedureCharge[];
  let services: Service[];
  let documents: ClinicalDocument[];
  try {
    [v, prescriptions, labOrders, labTests, procedures, services, documents] = await Promise.all([
      api<VisitDetail>(`/visits/${id}`),
      api<Prescription[]>(`/visits/${id}/prescriptions`),
      api<LabOrder[]>(`/visits/${id}/lab-orders`),
      api<LabTest[]>("/lab/tests"),
      api<ProcedureCharge[]>(`/visits/${id}/procedures`),
      api<Service[]>("/lookups/services"),
      api<ClinicalDocument[]>(`/visits/${id}/documents`),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) {
      return <p className="text-sm text-slate-500">Only doctors, nurses and admins can open consultation records.</p>;
    }
    throw e;
  }

  // Earlier results of the same tests (other visits), shown beside this visit's results.
  const labHistory = (await api<LabHistoryOrder[]>(`/patients/${v.patient.id}/lab-results`).catch(() => [])).filter((o) => o.visit.id !== v.id);
  // A pharmacy counter sale is shown for reference only: it is not a consultation.
  const closed = v.status === "COMPLETED" || v.status === "CANCELLED" || v.kind !== "OPD";
  const mode = v.kind !== "OPD" ? null : me.role === "DOCTOR" ? "doctor" : me.role === "NURSE" ? "nurse" : null;
  const feeUnpaid = v.prepayment && !v.consultationPaid;
  const age = ageFrom(v.patient.dateOfBirth);
  const returnTo = `/visits/${v.id}`;
  // The record beyond this visit: long-term conditions and how the vitals have moved.
  const clinical = ["ADMIN", "DOCTOR", "NURSE"].includes(me.role);
  const [problems, vitals] = clinical
    ? await Promise.all([api<PatientProblem[]>(`/patients/${v.patient.id}/problems`), api<VitalsRow[]>(`/patients/${v.patient.id}/vitals`)])
    : [[], []];

  return (
    <>
      <PageHeader
        title={fullName(v.patient)}
        subtitle={`${v.patient.mrn} · ${v.patient.sex === "MALE" ? "Male" : "Female"}${age !== null ? ` · ${age} years` : ""} · queue number ${v.queueNumber}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={v.status} />
            <Link href={`/patients/${v.patient.id}`} className={secondaryButtonClass}>
              <UserRound aria-hidden />
              Patient record
            </Link>
            {clinical && v.kind === "OPD" && v.status !== "WAITING" && v.status !== "CANCELLED" && (
              <Link href={`/visit-summary/${v.id}`} target="_blank" className={secondaryButtonClass}>
                <FileText aria-hidden />
                Visit summary
              </Link>
            )}
            {mode === "doctor" && (
              <Link href={`/appointments/new?patientId=${v.patient.id}`} className={secondaryButtonClass}>
                <CalendarPlus aria-hidden />
                Book follow-up
              </Link>
            )}
            <Link href="/queue" className={secondaryButtonClass}>
              <ListOrdered aria-hidden />
              Queue
            </Link>
          </div>
        }
      />

      <Flash params={flash} />
      <AllergyAlert allergies={v.patient.allergies} className={mode ? "mb-2" : "mb-4"} />
      {mode && !closed && (
        <div className="mb-4">
          <AllergyEditor patientId={v.patient.id} allergies={v.patient.allergies} />
        </div>
      )}

      <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
        <Clock aria-hidden className="size-4" />
        {formatDualDate(v.checkedInAt)} · arrived {formatTime(v.checkedInAt)}
        {v.calledAt && ` · seen after ${formatDuration(v.checkedInAt, v.calledAt)}`}
        {v.doctor && ` · Dr. ${v.doctor.fullName}`}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:gap-8">
        <div className="min-w-0 space-y-6">
          {/* Public health first: an immediately reportable disease is phoned through within 30 minutes. */}
          {v.notifiable && v.notifiable.length > 0 && (
            <NotifiablePanel visitId={v.id} items={v.notifiable} canReport={["ADMIN", "DOCTOR", "NURSE"].includes(me.role) && v.status !== "CANCELLED"} />
          )}
          {v.kind === "WALK_IN" && <Notice tone="info">This is a pharmacy counter sale, not a consultation.</Notice>}
          {v.kind === "LAB" && <Notice tone="info">This is a lab-only visit (tests without a consultation here).</Notice>}
          {v.status === "WAITING" && mode === "doctor" && feeUnpaid && (
            <Notice tone="warning">The consultation fee has not been paid yet. The patient can be called in once the cashier has taken it.</Notice>
          )}
          {Number(v.owed) > 0 && !feeUnpaid && v.status !== "WAITING" && (
            <Notice tone="warning">The patient still has {etb(v.owed)} to pay at the cashier before leaving.</Notice>
          )}
          {v.status === "WAITING" && mode === "doctor" && !feeUnpaid && (
            <form action={moveVisit.bind(null, v.id, "IN_CONSULTATION", returnTo)}>
              <Notice tone="warning">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>This patient is still waiting. Call them in to start the consultation.</span>
                  <button className={`${buttonClass} px-3 py-1.5 text-xs`}>Call in</button>
                </div>
              </Notice>
            </form>
          )}
          {v.status === "AWAITING_PHARMACY" && mode === "doctor" && (
            <form action={moveVisit.bind(null, v.id, "IN_CONSULTATION", returnTo)}>
              <Notice tone="info">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Sent to the pharmacy. The visit closes by itself once the drugs are dispensed.</span>
                  <button className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>Resume consultation</button>
                </div>
              </Notice>
            </form>
          )}
          {v.status === "AWAITING_LAB" && mode === "doctor" && (
            <form action={moveVisit.bind(null, v.id, "IN_CONSULTATION", returnTo)}>
              <Notice tone="info">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Waiting for lab results.</span>
                  <button className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>Results back: resume consultation</button>
                </div>
              </Notice>
            </form>
          )}

          {closed || !mode ? (
            <ReadOnly v={v} />
          ) : (
            <ConsultationForm
              visit={v}
              mode={mode}
              open={{
                diagnosed: v.diagnoses.length > 0,
                lab: labOrders.some((o) => o.status === "ORDERED" || o.status === "SAMPLE_COLLECTED" || o.status === "RESULTED"),
                rx: prescriptions.some((p) => p.status === "PENDING" || p.status === "PARTIALLY_DISPENSED"),
              }}
            />
          )}
          {v.kind === "OPD" && (
            <Addenda visitId={v.id} addenda={v.addenda ?? []} canAdd={(me.role === "DOCTOR" || me.role === "NURSE") && v.status !== "CANCELLED"} />
          )}
          <DiagnosisPanel visitId={v.id} diagnoses={v.diagnoses} editable={!closed && mode === "doctor"} />
          {/* Tests and drugs are ordered once the doctor has called the patient in. */}
          <LabPanel visitId={v.id} orders={labOrders} tests={labTests} history={labHistory} editable={!closed && mode === "doctor" && v.status !== "WAITING"} />
          <PrescriptionPanel visitId={v.id} prescriptions={prescriptions} editable={!closed && mode === "doctor" && v.status !== "WAITING"} />
          <ProceduresPanel visitId={v.id} items={procedures} procedures={services.filter((s) => s.kind === "PROCEDURE")} editable={!closed && !!mode} />
          {mode === "doctor" || documents.length > 0 ? (
            <DocumentsPanel visitId={v.id} documents={documents} canIssue={mode === "doctor" && v.status !== "WAITING" && v.status !== "CANCELLED"} diagnosis={v.diagnoses.find((d) => d.isPrimary)?.label ?? ""} />
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {clinical && v.kind === "OPD" && (
            <ProblemList patientId={v.patient.id} problems={problems} canEdit={me.role === "DOCTOR"} fromVisit={v.diagnoses} />
          )}
          {clinical && <VitalsTrend rows={vitals} />}
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <History aria-hidden className="size-4 text-slate-400" />
            Previous visits
          </h2>
          {v.previous.length === 0 ? (
            <p className="text-sm text-slate-500">First visit at this clinic.</p>
          ) : (
            <ul className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-1.75 before:w-px before:bg-slate-200 dark:before:bg-slate-800">
              {v.previous.map((p) => (
                <li key={p.id} className="relative pl-6 text-sm">
                  <span aria-hidden className="absolute top-1.5 left-0 size-3.75 rounded-full border-2 border-white bg-brand-600 ring-1 ring-brand-600/30 dark:border-slate-950" />
                  <div className="surface p-3">
                  <Link href={`/visits/${p.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                    {formatDualDate(p.checkedInAt)}
                  </Link>
                  {p.doctor && <span className="text-slate-500"> · Dr. {p.doctor.fullName}</span>}
                  {p.diagnoses.length > 0 && (
                    <p className="mt-1">{p.diagnoses.map((d) => `${d.label} (${d.icd11Code})`).join(", ")}</p>
                  )}
                  {p.chiefComplaint && <p className="mt-1 text-slate-600 dark:text-slate-400">{p.chiefComplaint}</p>}
                  {p.prescriptions.some((rx) => rx.items.length > 0) && (
                    <p className="mt-1 flex gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                      <Pill aria-hidden className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                      <span>
                        {p.prescriptions
                          .flatMap((rx) => rx.items)
                          .map((i) => `${[i.drug.genericName, i.drug.strength].filter(Boolean).join(" ")} · ${shortDirections(i)}`)
                          .join("; ")}
                      </span>
                    </p>
                  )}
                  {(p.systolicBp || p.weightKg) && (
                    <p className="mt-1 text-xs text-slate-500">
                      {p.systolicBp && p.diastolicBp && `BP ${p.systolicBp}/${p.diastolicBp}`}
                      {p.systolicBp && p.weightKg && " · "}
                      {p.weightKg && `${p.weightKg} kg`}
                    </p>
                  )}
                  {p.plan && <p className="mt-1 text-xs text-slate-500">Plan: {p.plan}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}

export default function VisitPage({ params, searchParams }: PageProps<"/visits/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Visit params={params} searchParams={searchParams as Promise<{ error?: string }>} />
    </Suspense>
  );
}

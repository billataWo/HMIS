import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { moveVisit } from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { Flash } from "@/components/flash";
import { api, ApiError, type LabOrder, type LabTest, type Me, type Prescription, type VisitDetail } from "@/lib/api";
import { ageFrom, formatDualDate, formatDuration, formatTime, fullName } from "@/lib/format";
import { ConsultationForm } from "./consultation-form";
import { DiagnosisPanel } from "./diagnosis-panel";
import { LabPanel } from "./lab-panel";
import { PrescriptionPanel } from "./prescription-panel";

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
  ];
  return (
    <div className="space-y-4 text-sm">
      <p>
        <span className="font-medium">Vitals: </span>
        {vitals.length ? vitals.join(" · ") : <span className="text-zinc-500">not recorded</span>}
      </p>
      {notes.map(([label, text]) => (
        <div key={label}>
          <h3 className="font-medium">{label}</h3>
          <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{text || <span className="text-zinc-500">—</span>}</p>
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
  try {
    [v, prescriptions, labOrders, labTests] = await Promise.all([
      api<VisitDetail>(`/visits/${id}`),
      api<Prescription[]>(`/visits/${id}/prescriptions`),
      api<LabOrder[]>(`/visits/${id}/lab-orders`),
      api<LabTest[]>("/lab/tests"),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) {
      return <p className="text-sm text-zinc-500">Only doctors, nurses and admins can open consultation records.</p>;
    }
    throw e;
  }

  const closed = v.status === "COMPLETED" || v.status === "CANCELLED";
  const mode = me.role === "DOCTOR" ? "doctor" : me.role === "NURSE" ? "nurse" : null;
  const age = ageFrom(v.patient.dateOfBirth);
  const returnTo = `/visits/${v.id}`;

  return (
    <>
      <PageHeader
        title={fullName(v.patient)}
        subtitle={`${v.patient.mrn} · ${v.patient.sex === "MALE" ? "Male" : "Female"}${age !== null ? ` · ${age} years` : ""} · queue number ${v.queueNumber}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={v.status} />
            <Link href={`/patients/${v.patient.id}`} className={secondaryButtonClass}>
              Patient record
            </Link>
            <Link href="/queue" className={secondaryButtonClass}>
              Queue
            </Link>
          </div>
        }
      />

      <Flash params={flash} />
      {v.patient.allergies.length > 0 && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          Allergies: {v.patient.allergies.join(", ")}
        </div>
      )}

      <p className="mb-6 text-sm text-zinc-500">
        {formatDualDate(v.checkedInAt)} · arrived {formatTime(v.checkedInAt)}
        {v.calledAt && ` · seen after ${formatDuration(v.checkedInAt, v.calledAt)}`}
        {v.doctor && ` · Dr. ${v.doctor.fullName}`}
      </p>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          {v.status === "WAITING" && mode === "doctor" && (
            <form action={moveVisit.bind(null, v.id, "IN_CONSULTATION", returnTo)} className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
              <p className="mb-2 text-sm">This patient is still waiting. Call them in to start the consultation.</p>
              <button className={buttonClass}>Call in</button>
            </form>
          )}
          {v.status === "AWAITING_PHARMACY" && mode === "doctor" && (
            <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950 dark:text-violet-100">
              Sent to the pharmacy. Notes can still be updated until the visit is completed.
            </p>
          )}
          {v.status === "AWAITING_LAB" && mode === "doctor" && (
            <form action={moveVisit.bind(null, v.id, "IN_CONSULTATION", returnTo)} className="flex items-center gap-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
              Waiting for lab results.
              <button className={`${secondaryButtonClass} px-3 py-1 text-xs`}>Results back: resume consultation</button>
            </form>
          )}

          {closed || !mode ? <ReadOnly v={v} /> : <ConsultationForm visit={v} mode={mode} />}
          <DiagnosisPanel visitId={v.id} diagnoses={v.diagnoses} editable={!closed && mode === "doctor"} />
          <LabPanel visitId={v.id} orders={labOrders} tests={labTests} editable={!closed && mode === "doctor"} />
          <PrescriptionPanel visitId={v.id} prescriptions={prescriptions} editable={!closed && mode === "doctor"} />
        </div>

        <aside>
          <h2 className="mb-2 font-medium">Previous visits</h2>
          {v.previous.length === 0 ? (
            <p className="text-sm text-zinc-500">First visit at this clinic.</p>
          ) : (
            <ul className="space-y-3">
              {v.previous.map((p) => (
                <li key={p.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <Link href={`/visits/${p.id}`} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                    {formatDualDate(p.checkedInAt)}
                  </Link>
                  {p.doctor && <span className="text-zinc-500"> · Dr. {p.doctor.fullName}</span>}
                  {p.diagnoses.length > 0 && (
                    <p className="mt-1">{p.diagnoses.map((d) => `${d.label} (${d.icd11Code})`).join(", ")}</p>
                  )}
                  {p.chiefComplaint && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{p.chiefComplaint}</p>}
                  {(p.systolicBp || p.weightKg) && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {p.systolicBp && p.diastolicBp && `BP ${p.systolicBp}/${p.diastolicBp}`}
                      {p.systolicBp && p.weightKg && " · "}
                      {p.weightKg && `${p.weightKg} kg`}
                    </p>
                  )}
                  {p.plan && <p className="mt-1 text-xs text-zinc-500">Plan: {p.plan}</p>}
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

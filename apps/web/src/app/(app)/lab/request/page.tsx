import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type LabTest, type Patient, type PatientCoverage } from "@/lib/api";
import { RequestForm } from "./request-form";
import { NoAccess } from "@/components/status-page";

type Search = { patientId?: string; from?: string };

/** The tests on offer and, when the page was opened from a patient's record, that patient. */
async function load(patientId?: string) {
  try {
    const [tests, patient] = await Promise.all([
      api<LabTest[]>("/lab/tests"),
      patientId ? api<Patient>(`/patients/${patientId}`).catch(() => null) : null,
    ]);
    // Who can pay for the tests (the coverage list is for the front desk and the lab).
    if (patient) patient.coverages = (await api<PatientCoverage[]>(`/patients/${patient.id}/coverages`).catch(() => [])).filter((c) => c.active);
    return { tests, patient };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

async function Request({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const data = await load(q.patientId);
  const t = await getT();
  if (!data) return <NoAccess>{t("Only the front desk, the lab and admins add lab-only requests.")}</NoAccess>;
  return <RequestForm tests={data.tests} patient={data.patient} returnTo={q.from === "lab" ? "lab" : "patient"} />;
}

export default function LabRequestPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <>
      <PageTitle title="Lab-only request" subtitle="Tests without a consultation: a request from another clinic, or the patient's own" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Request searchParams={searchParams} />
      </Suspense>
    </>
  );
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AllergyEditor } from "@/components/allergy-editor";
import { Notice, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type Me, type PatientDetail } from "@/lib/api";
import { canRegister } from "@/lib/roles";
import { PatientForm } from "../../new/patient-form";

async function EditForm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let p: PatientDetail;
  let me: Me;
  try {
    [p, me] = await Promise.all([api<PatientDetail>(`/patients/${id}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  if (!canRegister(me)) {
    // Doctors without registration rights may still keep allergies up to date.
    return me.role === "DOCTOR" ? (
      <div className="max-w-xl space-y-4">
        <Notice tone="info">Details are corrected at reception. You can update the allergy list here.</Notice>
        <AllergyEditor patientId={p.id} allergies={p.allergies} />
      </div>
    ) : (
      <Notice tone="info">Patient details are corrected at reception.</Notice>
    );
  }

  return (
    <PatientForm
      patientId={p.id}
      defaults={{
        firstName: p.firstName,
        fatherName: p.fatherName,
        grandfather: p.grandfather ?? "",
        firstNameAm: p.firstNameAm ?? "",
        fatherNameAm: p.fatherNameAm ?? "",
        sex: p.sex,
        dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "",
        phone: p.phone ?? "",
        address: p.address ?? "",
        allergies: p.allergies.join(", "),
      }}
    />
  );
}

export default function EditPatientPage({ params }: PageProps<"/patients/[id]/edit">) {
  return (
    <>
      <PageHeader title="Edit patient" subtitle="የታካሚ መረጃ ማስተካከያ" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <EditForm params={params} />
      </Suspense>
    </>
  );
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AllergyEditor } from "@/components/allergy-editor";
import { PageTitle } from "@/components/page-title";
import { Notice, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type Me, type PatientDetail } from "@/lib/api";
import { ageParts } from "@/lib/format";
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

  const t = await getT();
  if (!canRegister(me)) {
    // Doctors without registration rights may still keep allergies up to date.
    return me.role === "DOCTOR" ? (
      <div className="max-w-xl space-y-4">
        <Notice tone="info">{t("Details are corrected at reception. You can update the allergy list here.")}</Notice>
        <AllergyEditor patientId={p.id} allergies={p.allergies} />
      </div>
    ) : (
      <Notice tone="info">{t("Patient details are corrected at reception.")}</Notice>
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
        // A birth date worked out from an age is shown as that age again.
        ...(p.dobEstimated && p.dateOfBirth
          ? { ageYears: String(ageParts(p.dateOfBirth).years), ageMonths: String(ageParts(p.dateOfBirth).months) }
          : { dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "" }),
        phone: p.phone ?? "",
        address: p.address ?? "",
        region: p.region ?? "",
        zone: p.zone ?? "",
        woreda: p.woreda ?? "",
        kebele: p.kebele ?? "",
        houseNo: p.houseNo ?? "",
        nationalId: p.nationalId ?? "",
        nextOfKinName: p.nextOfKinName ?? "",
        nextOfKinRelation: p.nextOfKinRelation ?? "",
        nextOfKinPhone: p.nextOfKinPhone ?? "",
        allergies: p.allergies.join(", "),
      }}
    />
  );
}

export default function EditPatientPage({ params }: PageProps<"/patients/[id]/edit">) {
  return (
    <>
      <PageTitle title="Edit patient" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <EditForm params={params} />
      </Suspense>
    </>
  );
}

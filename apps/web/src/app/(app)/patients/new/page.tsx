import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, type Patient } from "@/lib/api";
import { fullName } from "@/lib/format";
import { PatientForm } from "./patient-form";

async function FormWithRelative({ searchParams }: { searchParams: Promise<{ relativeOf?: string }> }) {
  const { relativeOf } = await searchParams;
  const relative = relativeOf ? await api<Patient>(`/patients/${relativeOf}`).catch(() => null) : null;
  return (
    <PatientForm
      relative={relative ? { id: relative.id, label: `${fullName(relative)} (${relative.mrn})` } : undefined}
      defaults={relative ? { fatherName: relative.fatherName, phone: relative.phone ?? "", address: relative.address ?? "" } : {}}
    />
  );
}

export default function NewPatientPage({ searchParams }: PageProps<"/patients/new">) {
  return (
    <>
      <PageHeader title="Register patient" subtitle="አዲስ ታካሚ መመዝገብ" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <FormWithRelative searchParams={searchParams as Promise<{ relativeOf?: string }>} />
      </Suspense>
    </>
  );
}

import { UserRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Me, type Patient } from "@/lib/api";
import { fullName } from "@/lib/format";
import { canRegister } from "@/lib/roles";
import { PatientForm } from "./patient-form";

async function FormWithRelative({ searchParams }: { searchParams: Promise<{ relativeOf?: string }> }) {
  const { relativeOf } = await searchParams;
  const me = await api<Me>("/auth/me");
  if (!canRegister(me)) {
    return (
      <EmptyState
        icon={UserRound}
        title="Patients are registered at reception"
        action={
          <Link href="/patients" className={secondaryButtonClass}>
            Search patients
          </Link>
        }
      >
        Registration is done by the receptionist, a nurse or an admin, together with check-in. Search for the patient instead.
      </EmptyState>
    );
  }
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

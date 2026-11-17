import { UserRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { EmptyState, secondaryButtonClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, type Me, type Patient } from "@/lib/api";
import { fullName } from "@/lib/format";
import { canRegister } from "@/lib/roles";
import { PatientForm } from "./patient-form";

async function FormWithRelative({ searchParams }: { searchParams: Promise<{ relativeOf?: string }> }) {
  const { relativeOf } = await searchParams;
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (!canRegister(me)) {
    return (
      <EmptyState
        icon={UserRound}
        title={t("Patients are registered at reception")}
        action={
          <Link href="/patients" className={secondaryButtonClass}>
            {t("Search patients")}
          </Link>
        }
      >
        {t("Registration is done by the receptionist, a nurse or an admin, together with check-in. Search for the patient instead.")}
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
      <PageTitle title="Register patient" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <FormWithRelative searchParams={searchParams as Promise<{ relativeOf?: string }>} />
      </Suspense>
    </>
  );
}

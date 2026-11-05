import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type Doctor, type Patient } from "@/lib/api";
import { clinicToday, fullName } from "@/lib/format";
import { BookForm } from "./book-form";

async function Booking({ searchParams }: { searchParams: Promise<{ patientId?: string }> }) {
  const { patientId } = await searchParams;
  if (!patientId) {
    return (
      <p className="text-sm text-zinc-500">
        Choose the patient first:{" "}
        <Link href="/patients" className="text-teal-700 underline dark:text-teal-400">
          find a patient
        </Link>{" "}
        and click “Book appointment”.
      </p>
    );
  }

  let patient: Patient;
  try {
    patient = await api<Patient>(`/patients/${patientId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const doctors = await api<Doctor[]>("/lookups/doctors");

  return (
    <>
      <p className="mb-4 text-sm">
        For <strong>{fullName(patient)}</strong> <span className="text-zinc-500">· {patient.mrn}</span>
      </p>
      <BookForm patientId={patient.id} doctors={doctors} today={clinicToday()} />
    </>
  );
}

export default function NewAppointmentPage({ searchParams }: PageProps<"/appointments/new">) {
  return (
    <>
      <PageHeader title="Book appointment" subtitle="ቀጠሮ መያዝ" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Booking searchParams={searchParams as Promise<{ patientId?: string }>} />
      </Suspense>
    </>
  );
}

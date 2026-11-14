import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type Appointment, type BookingLoad, type Doctor, type Patient } from "@/lib/api";
import { clinicToday, fullName } from "@/lib/format";
import { BookForm } from "./book-form";

async function Booking({ searchParams }: { searchParams: Promise<{ patientId?: string; move?: string }> }) {
  const { patientId, move } = await searchParams;
  if (!patientId) {
    return (
      <p className="text-sm text-slate-500">
        Choose the patient first:{" "}
        <Link href="/patients" className="text-brand-700 underline dark:text-brand-400">
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
  const [doctors, load, upcoming] = await Promise.all([
    api<Doctor[]>("/lookups/doctors"),
    api<BookingLoad>("/appointments/load"),
    move ? api<Appointment[]>(`/appointments?patientId=${patient.id}`) : Promise.resolve([] as Appointment[]),
  ]);
  // Moving one of the patient's booked appointments: start from its time and doctor.
  const moving = upcoming.find((a) => a.id === move);
  const when = moving && new Date(moving.scheduledAt);
  const local = when && new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Addis_Ababa", hour: "2-digit", minute: "2-digit", hour12: false }).format(when);

  return (
    <>
      <p className="mb-4 text-sm">
        {moving ? "Moving the appointment of" : "For"} <strong>{fullName(patient)}</strong> <span className="text-slate-500">· {patient.mrn}</span>
        {moving?.reason && <span className="text-slate-500"> · {moving.reason}</span>}
      </p>
      <BookForm
        patientId={patient.id}
        doctors={doctors}
        today={clinicToday()}
        load={load}
        move={moving && when ? { id: moving.id, date: clinicToday(when), time: local!, doctorId: moving.doctor?.id ?? null } : undefined}
      />
    </>
  );
}

export default function NewAppointmentPage({ searchParams }: PageProps<"/appointments/new">) {
  return (
    <>
      <PageHeader title="Book appointment" subtitle="ቀጠሮ መያዝ" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Booking searchParams={searchParams as Promise<{ patientId?: string; move?: string }>} />
      </Suspense>
    </>
  );
}

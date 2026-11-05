import Link from "next/link";
import { Suspense } from "react";
import { setAppointmentStatus } from "@/app/actions";
import { CheckInForm } from "@/components/check-in-form";
import { Flash } from "@/components/flash";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Appointment, type Doctor, type Me, type Role, type Service } from "@/lib/api";
import { clinicToday, formatDualDate, formatTime, fullName, shiftDay } from "@/lib/format";

type Search = { day?: string; error?: string; booked?: string };

const FRONT_DESK: Role[] = ["ADMIN", "RECEPTIONIST", "NURSE"];
const CAN_BOOK: Role[] = ["ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR"];

const APPT_STATUS: Record<Appointment["status"], { label: string; className: string }> = {
  BOOKED: { label: "Booked", className: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100" },
  ARRIVED: { label: "Arrived", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" },
  CANCELLED: { label: "Cancelled", className: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800" },
  NO_SHOW: { label: "No-show", className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100" },
};

async function Day({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const today = clinicToday();
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today;
  const [me, appts, doctors, services] = await Promise.all([
    api<Me>("/auth/me"),
    api<Appointment[]>(`/appointments?day=${day}`),
    api<Doctor[]>("/lookups/doctors"),
    api<Service[]>("/lookups/services"),
  ]);
  const returnTo = `/appointments?day=${day}`;
  const dayLink = (d: string, label: string) => (
    <Link href={`/appointments?day=${d}`} className={secondaryButtonClass}>
      {label}
    </Link>
  );

  return (
    <>
      <Flash params={params} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {dayLink(shiftDay(day, -1), "←")}
        <span className="px-2 font-medium">
          {formatDualDate(`${day}T12:00:00+03:00`)}
          {day === today && <span className="text-zinc-500"> · today</span>}
        </span>
        {dayLink(shiftDay(day, 1), "→")}
        {day !== today && dayLink(today, "Today")}
      </div>

      {appts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No appointments on this day.
          {CAN_BOOK.includes(me.role) && " To book one, open a patient and choose “Book appointment”."}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {appts.map((a) => {
            const s = APPT_STATUS[a.status];
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-4 p-4">
                <span className="w-14 pt-0.5 font-semibold tabular-nums">{formatTime(a.scheduledAt)}</span>
                <div className="min-w-48 flex-1">
                  <Link href={`/patients/${a.patient.id}`} className="font-medium hover:underline">
                    {fullName(a.patient)}
                  </Link>
                  <span className="text-sm text-zinc-500">
                    {" "}· {a.patient.mrn}
                    {a.patient.phone && ` · ${a.patient.phone}`}
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${s.className}`}>{s.label}</span>
                    {a.doctor && <span>Dr. {a.doctor.fullName}</span>}
                    {a.reason && <span>{a.reason}</span>}
                    {a.visit && <span>Queue number {a.visit.queueNumber}</span>}
                  </div>
                </div>
                {a.status === "BOOKED" && (
                  <div className="flex flex-col items-end gap-2">
                    {day === today && FRONT_DESK.includes(me.role) && (
                      <CheckInForm
                        patientId={a.patient.id}
                        appointmentId={a.id}
                        defaultDoctorId={a.doctor?.id}
                        doctors={doctors}
                        services={services}
                        returnTo={returnTo}
                      />
                    )}
                    {CAN_BOOK.includes(me.role) && (
                      <div className="flex gap-2">
                        {day <= today && (
                          <form action={setAppointmentStatus.bind(null, a.id, "NO_SHOW", returnTo)}>
                            <button className={`${secondaryButtonClass} px-3 py-1 text-xs`}>No-show</button>
                          </form>
                        )}
                        <form action={setAppointmentStatus.bind(null, a.id, "CANCELLED", returnTo)}>
                          <button className={`${secondaryButtonClass} px-3 py-1 text-xs text-red-700 dark:text-red-400`}>Cancel</button>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  return (
    <>
      <PageHeader title="Appointments" subtitle="ቀጠሮዎች" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Day searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

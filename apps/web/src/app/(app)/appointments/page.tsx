import { connection } from "next/server";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { setAppointmentStatus } from "@/app/actions";
import { CheckInForm } from "@/components/check-in-form";
import { Flash } from "@/components/flash";
import { Badge, type BadgeTone, EmptyState, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Appointment, type Doctor, type Me, type Role, type Service } from "@/lib/api";
import { clinicToday, formatDualDate, formatTime, fullName, shiftDay } from "@/lib/format";
import { ConfirmCancel } from "@/components/confirm-cancel";

type Search = { day?: string; error?: string; booked?: string };

const FRONT_DESK: Role[] = ["ADMIN", "RECEPTIONIST", "NURSE"];
const CAN_BOOK: Role[] = ["ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR"];

const APPT_STATUS: Record<Appointment["status"], { label: string; tone: BadgeTone }> = {
  BOOKED: { label: "Booked", tone: "info" },
  ARRIVED: { label: "Arrived", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  NO_SHOW: { label: "No-show", tone: "danger" },
};

async function Day({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  await connection(); // "today" is the request's, not a prerender's
  const today = clinicToday();
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today;
  const [me, appts, doctors, services] = await Promise.all([
    api<Me>("/auth/me"),
    api<Appointment[]>(`/appointments?day=${day}`),
    api<Doctor[]>("/lookups/doctors"),
    api<Service[]>("/lookups/services"),
  ]);
  const returnTo = `/appointments?day=${day}`;
  const dayLink = (d: string, label: ReactNode, aria?: string) => (
    <Link href={`/appointments?day=${d}`} aria-label={aria} className={`${secondaryButtonClass} ${aria ? "px-2.5" : ""}`}>
      {label}
    </Link>
  );

  return (
    <>
      <Flash params={params} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {dayLink(shiftDay(day, -1), <ChevronLeft aria-hidden />, "Previous day")}
        <span className="px-2 font-medium">
          {formatDualDate(`${day}T12:00:00+03:00`)}
          {day === today && <span className="text-slate-500"> · today</span>}
        </span>
        {dayLink(shiftDay(day, 1), <ChevronRight aria-hidden />, "Next day")}
        {day !== today && dayLink(today, "Today")}
      </div>

      {appts.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No appointments on this day">
          {CAN_BOOK.includes(me.role) && "To book one, open a patient and choose “Book appointment”."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-200 surface dark:divide-slate-800 dark:border-slate-800">
          {appts.map((a) => {
            const s = APPT_STATUS[a.status];
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-4 p-4">
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-semibold tabular-nums text-slate-800 dark:bg-slate-800 dark:text-slate-100">{formatTime(a.scheduledAt)}</span>
                <div className="min-w-48 flex-1">
                  <Link href={`/patients/${a.patient.id}`} className="font-medium hover:underline">
                    {fullName(a.patient)}
                  </Link>
                  <span className="text-sm text-slate-500">
                    {" "}· {a.patient.mrn}
                    {a.patient.phone && ` · ${a.patient.phone}`}
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone={s.tone} dot>
                      {a.status === "CANCELLED" ? <s>{s.label}</s> : s.label}
                    </Badge>
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
                        <ConfirmCancel action={setAppointmentStatus.bind(null, a.id, "CANCELLED", returnTo)} question="Cancel this appointment?" />
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

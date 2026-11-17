import { ChevronLeft, ChevronRight, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { recordReminder } from "@/app/actions";
import { Flash } from "@/components/flash";
import { PageTitle } from "@/components/page-title";
import { Badge, EmptyState, linkClass, Notice, pillClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Me, type MissedAppointment, type ReminderList } from "@/lib/api";
import { REMINDER_OUTCOMES, TRACE_OUTCOMES } from "@/lib/appointment-follow-up";
import { clinicToday, formatAgo, formatDualDate, formatTime, fullName, shiftDay } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { TraceForm } from "./trace-form";

export const metadata: Metadata = { title: "Reminders and missed appointments" };

type Search = { tab?: string; day?: string; error?: string; done?: string };

const small = `${secondaryButtonClass} px-2.5 py-1 text-xs`;

function PhoneLink({ phone, t }: { phone: string | null; t: T }) {
  if (!phone) return <span className="text-slate-500">{t("no phone")}</span>;
  return (
    <a href={`tel:${phone}`} className={`${linkClass} inline-flex items-center gap-1`}>
      <Phone aria-hidden className="size-3.5" />
      {phone}
    </a>
  );
}

/** The day's reminder calls: who is booked, their phone, and what came of each call. */
async function Reminders({ day, returnTo }: { day: string; returnTo: string }) {
  const [r, t] = await Promise.all([api<ReminderList>(`/appointments/reminders?day=${day}`), getT()]);
  const today = clinicToday();
  const left = r.appointments.filter((a) => !a.reminderOutcome).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/appointments/follow-up?day=${shiftDay(day, -1)}`} aria-label={t("Previous day")} className={`${secondaryButtonClass} px-2.5`}>
          <ChevronLeft aria-hidden />
        </Link>
        <span className="px-2 font-medium">
          {formatDualDate(`${day}T12:00:00+03:00`)}
          {day === shiftDay(today, 1) && <span className="text-slate-500"> · {t("tomorrow")}</span>}
        </span>
        <Link href={`/appointments/follow-up?day=${shiftDay(day, 1)}`} aria-label={t("Next day")} className={`${secondaryButtonClass} px-2.5`}>
          <ChevronRight aria-hidden />
        </Link>
        {r.appointments.length > 0 && <Badge tone={left ? "warning" : "success"}>{left ? t("{n} still to call", { n: left }) : t("All called")}</Badge>}
      </div>
      {r.appointments.length === 0 ? (
        <EmptyState title={t("Nobody is booked on this day")} />
      ) : (
        <ul className="surface divide-y divide-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {r.appointments.map((a) => {
            const o = REMINDER_OUTCOMES.find((x) => x.value === a.reminderOutcome);
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
                <div className="min-w-48 flex-1 space-y-1">
                  <p>
                    <span className="font-semibold tabular-nums">{formatTime(a.scheduledAt)}</span>{" "}
                    <Link href={`/patients/${a.patient.id}`} className="font-medium hover:underline">
                      {fullName(a.patient)}
                    </Link>{" "}
                    <span className="text-slate-500">· {a.patient.mrn}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <PhoneLink phone={a.patient.phone} t={t} />
                    {a.doctor && <span>{t("Dr. {name}", { name: a.doctor.fullName })}</span>}
                    {a.reason && <span>{a.reason}</span>}
                  </p>
                  {o && (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Badge tone={o.tone}>{t(o.label)}</Badge>
                      {a.reminderBy && `${a.reminderBy}, ${formatAgo(a.reminderSentAt, t)}`}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {REMINDER_OUTCOMES.map((x) => (
                    <form key={x.value} action={recordReminder.bind(null, a.id, x.value, returnTo)}>
                      <button className={small} aria-pressed={a.reminderOutcome === x.value}>
                        {t(x.label)}
                      </button>
                    </form>
                  ))}
                  <Link href={`/appointments/new?patientId=${a.patient.id}&move=${a.id}`} className={small}>
                    {t("Move")}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Missed appointments to trace: long-term conditions first. */
async function Missed() {
  const [rows, t] = await Promise.all([api<MissedAppointment[]>("/appointments/missed"), getT()]);
  if (rows.length === 0) {
    return <EmptyState title={t("No missed appointments to follow up")}>{t("Everyone who missed an appointment in the last 90 days has come back or booked again.")}</EmptyState>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((a) => {
        const o = TRACE_OUTCOMES.find((x) => x.value === a.traceOutcome);
        return (
          <li key={a.id} className={`surface space-y-3 p-4 text-sm ${a.problems.length ? "border-amber-300 dark:border-amber-800" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p>
                  <Link href={`/patients/${a.patient.id}`} className="font-semibold hover:underline">
                    {fullName(a.patient)}
                  </Link>{" "}
                  <span className="text-slate-500">· {a.patient.mrn}</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <PhoneLink phone={a.patient.phone} t={t} />
                  <span>
                    {t("Missed {date}", { date: formatDualDate(a.scheduledAt) })}
                    {a.reason && ` (${a.reason})`}
                  </span>
                  <span>{a.lastVisitAt ? t("last seen {date}", { date: formatDualDate(a.lastVisitAt) }) : t("never seen here")}</span>
                </p>
                {a.problems.length > 0 && (
                  <p className="flex flex-wrap gap-1.5">
                    {a.problems.map((p) => (
                      <Badge key={p} tone="warning">
                        {p}
                      </Badge>
                    ))}
                  </p>
                )}
                {o && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone={o.tone}>{t(o.label)}</Badge>
                    {a.traceNote && <span>{a.traceNote}</span>}
                    {a.tracedBy && <span>· {a.tracedBy}, {formatAgo(a.tracedAt, t)}</span>}
                  </p>
                )}
              </div>
              <Link href={`/appointments/new?patientId=${a.patient.id}`} className={small}>
                {t("Book again")}
              </Link>
            </div>
            <TraceForm appointmentId={a.id} />
          </li>
        );
      })}
    </ul>
  );
}

async function FollowUp({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  await connection(); // "tomorrow" is the request's, not a prerender's
  const tab = params.tab === "missed" ? "missed" : "reminders";
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : shiftDay(clinicToday(), 1);
  const returnTo = `/appointments/follow-up?day=${day}`;
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (!["ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR"].includes(me.role)) return <Notice tone="info">{t("Reminder calls are made at the front desk.")}</Notice>;
  return (
    <div className="space-y-4">
      <Flash params={params} />
      <nav className="flex flex-wrap gap-2" aria-label={t("Follow-up lists")}>
        <Link href="/appointments/follow-up" aria-current={tab === "reminders" ? "page" : undefined} className={pillClass(tab === "reminders")}>
          {t("Reminder calls")}
        </Link>
        <Link href="/appointments/follow-up?tab=missed" aria-current={tab === "missed" ? "page" : undefined} className={pillClass(tab === "missed")}>
          {t("Missed appointments")}
        </Link>
      </nav>
      {tab === "missed" ? <Missed /> : <Reminders day={day} returnTo={returnTo} />}
    </div>
  );
}

export default function FollowUpPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <>
      <PageTitle title="Reminders and missed appointments" subtitle="phone before the day, follow up after" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <FollowUp searchParams={searchParams} />
      </Suspense>
    </>
  );
}

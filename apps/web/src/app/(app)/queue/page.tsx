import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { moveVisit } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { CheckInForm } from "@/components/check-in-form";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass, inputClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Doctor, type Me, type Patient, type QueueResponse, type QueueVisit, type Role, type Service, type VisitStatus } from "@/lib/api";
import { ageFrom, formatDualDate, formatDuration, formatTime, fullName } from "@/lib/format";

type Search = { find?: string; doctor?: string; error?: string; checkedIn?: string };

const CLINICAL: Role[] = ["ADMIN", "DOCTOR", "NURSE"];
const FRONT_DESK: Role[] = ["ADMIN", "RECEPTIONIST", "NURSE"];

const NEXT_STEPS: Partial<Record<VisitStatus, { to: VisitStatus; label: string; primary?: boolean }[]>> = {
  WAITING: [{ to: "IN_CONSULTATION", label: "Call in", primary: true }],
  IN_CONSULTATION: [
    { to: "COMPLETED", label: "Complete", primary: true },
    { to: "AWAITING_LAB", label: "Send to lab" },
    { to: "AWAITING_PHARMACY", label: "Send to pharmacy" },
    { to: "WAITING", label: "Back to queue" },
  ],
  AWAITING_LAB: [
    { to: "IN_CONSULTATION", label: "Back to doctor", primary: true },
    { to: "COMPLETED", label: "Complete" },
  ],
  AWAITING_PHARMACY: [{ to: "COMPLETED", label: "Complete", primary: true }],
};

function VisitRow({ v, role, returnTo, prepayment }: { v: QueueVisit; role: Role; returnTo: string; prepayment: boolean }) {
  const age = ageFrom(v.patient.dateOfBirth);
  const unpaid = prepayment && v.status === "WAITING" && v.consultationPaid === false;
  // An unpaid patient can't be called in yet, so don't offer the button.
  const steps = CLINICAL.includes(role) ? (NEXT_STEPS[v.status] ?? []).filter((s) => !(unpaid && s.to === "IN_CONSULTATION")) : [];
  const canCancel = v.status === "WAITING" && role !== "CASHIER" && role !== "PHARMACIST" && role !== "LAB_TECH";
  const small = "px-3 py-1 text-xs";

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="w-10 text-center text-2xl font-semibold tabular-nums">{v.queueNumber}</span>
      <div className="min-w-48 flex-1">
        <Link href={`/patients/${v.patient.id}`} className="font-medium hover:underline">
          {fullName(v.patient)}
        </Link>
        <span className="text-sm text-zinc-500">
          {" "}· {v.patient.mrn} · {v.patient.sex === "MALE" ? "M" : "F"}
          {age !== null && ` · ${age}y`}
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <StatusBadge status={v.status} />
          {unpaid && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-900 dark:bg-red-950 dark:text-red-100">Awaiting payment</span>}
          {v.status === "AWAITING_LAB" && v.labReady && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">Results ready</span>
          )}
          <span>Arrived {formatTime(v.checkedInAt)}</span>
          {v.status === "WAITING" && <span className="font-medium text-amber-700 dark:text-amber-400">waiting {formatDuration(v.checkedInAt)}</span>}
          {v.doctor && <span>Dr. {v.doctor.fullName}</span>}
          {v.patient.allergies.length > 0 && <span className="font-medium text-red-700 dark:text-red-400">Allergies: {v.patient.allergies.join(", ")}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {CLINICAL.includes(role) && v.status !== "CANCELLED" && (
          <Link href={`/visits/${v.id}`} className={`${secondaryButtonClass} ${small}`}>
            {v.status === "WAITING" && role === "NURSE" ? "Triage" : "Open"}
          </Link>
        )}
        {steps.map((s) => (
          // Calling a patient in takes the doctor straight to the consultation screen.
          <form key={s.to} action={moveVisit.bind(null, v.id, s.to, s.to === "IN_CONSULTATION" ? `/visits/${v.id}` : returnTo)}>
            <button className={`${s.primary ? buttonClass : secondaryButtonClass} ${small}`}>{s.label}</button>
          </form>
        ))}
        {canCancel && (
          <form action={moveVisit.bind(null, v.id, "CANCELLED", returnTo)}>
            <button className={`${secondaryButtonClass} ${small} text-red-700 dark:text-red-400`}>Cancel</button>
          </form>
        )}
      </div>
    </li>
  );
}

function Column({
  title,
  visits,
  empty,
  role,
  returnTo,
  prepayment,
}: {
  title: string;
  visits: QueueVisit[];
  empty: string;
  role: Role;
  returnTo: string;
  prepayment: boolean;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">
        {title} <span className="text-zinc-500">({visits.length})</span>
      </h2>
      {visits.length === 0 ? (
        <p className="py-4 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {visits.map((v) => (
            <VisitRow key={v.id} v={v} role={role} returnTo={returnTo} prepayment={prepayment} />
          ))}
        </ul>
      )}
    </section>
  );
}

async function CheckInPanel({ find, doctors, services }: { find: string; doctors: Doctor[]; services: Service[] }) {
  const matches = find ? await api<Patient[]>(`/patients?q=${encodeURIComponent(find)}&take=8`) : [];
  return (
    <section className="mb-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-3 font-medium">Check in a patient</h2>
      <Form action="/queue" className="flex gap-2">
        <input name="find" defaultValue={find} placeholder="Name, phone or MRN" className={inputClass} />
        <button className={secondaryButtonClass}>Find</button>
      </Form>
      {find && (
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {matches.length === 0 && (
            <li className="py-3 text-sm text-zinc-500">
              No match.{" "}
              <Link href="/patients/new" className="text-teal-700 underline dark:text-teal-400">
                Register a new patient
              </Link>
            </li>
          )}
          {matches.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <span className="font-medium">{fullName(p)}</span>
                <span className="text-sm text-zinc-500">
                  {" "}· {p.mrn}
                  {p.phone && ` · ${p.phone}`}
                </span>
              </div>
              <CheckInForm patientId={p.id} doctors={doctors} services={services} returnTo="/queue" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Queue({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const [me, doctors, services] = await Promise.all([
    api<Me>("/auth/me"),
    api<Doctor[]>("/lookups/doctors"),
    api<Service[]>("/lookups/services"),
  ]);
  const doctorFilter =
    params.doctor === "me" ? (me.role === "DOCTOR" ? me.id : undefined) : doctors.find((d) => d.id === params.doctor)?.id;
  const { day, visits, prepayment } = await api<QueueResponse>(
    `/queue${doctorFilter ? `?doctorId=${doctorFilter}` : ""}`,
  );

  const returnTo = `/queue${params.doctor ? `?doctor=${params.doctor}` : ""}`;
  const waiting = visits.filter((v) => v.status === "WAITING");
  const active = visits.filter((v) => ["IN_CONSULTATION", "AWAITING_LAB", "AWAITING_PHARMACY"].includes(v.status));
  const done = visits.filter((v) => v.status === "COMPLETED" || v.status === "CANCELLED");
  const filterLink = (value: string | undefined, label: string) => (
    <Link
      key={label}
      href={value ? `/queue?doctor=${value}` : "/queue"}
      className={`rounded-full px-3 py-1 text-sm ${params.doctor === value ? "bg-teal-700 text-white" : "border border-zinc-300 dark:border-zinc-700"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Queue"
        subtitle={`ወረፋ · ${formatDualDate(`${day}T12:00:00+03:00`)} · ${visits.length} patients today`}
        actions={
          <Link href="/display" target="_blank" className={secondaryButtonClass}>
            Waiting-room display ↗
          </Link>
        }
      />
      <AutoRefresh seconds={15} />
      <Flash params={params} />

      {FRONT_DESK.includes(me.role) && <CheckInPanel find={params.find?.trim() ?? ""} doctors={doctors} services={services} />}

      {doctors.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {filterLink(undefined, "All doctors")}
          {me.role === "DOCTOR" && filterLink("me", "My patients")}
          {doctors.filter((d) => d.id !== me.id).map((d) => filterLink(d.id, `Dr. ${d.fullName}`))}
        </div>
      )}

      <div className="space-y-6">
        <Column title="Waiting" visits={waiting} empty="Nobody is waiting." role={me.role} returnTo={returnTo} prepayment={prepayment} />
        <Column title="In progress" visits={active} empty="No patient is with a doctor, at the lab or at the pharmacy." role={me.role} returnTo={returnTo} prepayment={prepayment} />
        {done.length > 0 && (
          <details className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <summary className="cursor-pointer font-medium">
              Finished today <span className="text-zinc-500">({done.length})</span>
            </summary>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {done.map((v) => (
                <VisitRow key={v.id} v={v} role={me.role} returnTo={returnTo} prepayment={prepayment} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

export default function QueuePage({ searchParams }: PageProps<"/queue">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Queue searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}

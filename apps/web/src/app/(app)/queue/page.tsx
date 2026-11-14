import { ChevronDown, CircleCheck, Clock, ExternalLink, Search, TriangleAlert, UserPlus, Users } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { cancelVisit, moveVisit, transferVisit } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { CheckInForm } from "@/components/check-in-form";
import { CancelVisit } from "@/components/cancel-visit";
import { CANCEL_REASONS } from "@/lib/cancel-reasons";
import { TransferDoctor } from "@/components/transfer-doctor";
import { Flash } from "@/components/flash";
import { StaggerItem, StaggerList } from "@/components/enter";
import { StatusBadge } from "@/components/status-badge";
import { Badge, buttonClass, inputClass, linkClass, PageHeader, pillClass, secondaryButtonClass, Skeleton, StatCard } from "@/components/ui";
import { api, type Doctor, type Me, type Patient, type QueueResponse, type QueueVisit, type Role, type Service, type VisitStatus } from "@/lib/api";
import { ageText, etb, formatDualDate, formatDuration, formatTime, fullName } from "@/lib/format";
import { TRIAGE } from "../visits/[id]/vital-flags";
import { type Lang, tr } from "@/lib/i18n";
import { getLang } from "@/lib/lang";

type Search = { find?: string; doctor?: string; error?: string; checkedIn?: string };

const CLINICAL: Role[] = ["ADMIN", "DOCTOR", "NURSE"];
const FRONT_DESK: Role[] = ["ADMIN", "RECEPTIONIST", "NURSE"];

type Step = { to: VisitStatus; label: string; primary?: boolean };

/**
 * Only the moves the API will accept for this visit right now: no "Send to lab" without an
 * ordered test, no "Complete" while results are pending or drugs are still to be collected.
 */
function nextSteps(v: QueueVisit, unpaid: boolean): Step[] {
  const lab = !!v.labPending;
  const rx = !!v.rxPending;
  // Ending the consultation needs a diagnosis, recorded on the visit screen ("Open").
  const dx = !!v.diagnosed;
  switch (v.status) {
    case "WAITING":
      // An unpaid patient can't be called in yet.
      return unpaid ? [] : [{ to: "IN_CONSULTATION", label: "Call in", primary: true }];
    case "IN_CONSULTATION": {
      const steps: Step[] = [];
      if (lab) steps.push({ to: "AWAITING_LAB", label: "Send to lab", primary: true });
      if (rx && dx) steps.push({ to: "AWAITING_PHARMACY", label: "Send to pharmacy", primary: !lab });
      if (!lab && !rx && dx) steps.push({ to: "COMPLETED", label: "Complete", primary: true });
      steps.push({ to: "WAITING", label: "Back to queue" });
      return steps;
    }
    case "AWAITING_LAB":
      return [
        { to: "IN_CONSULTATION", label: "Back to doctor", primary: true },
        ...(!lab && !rx && dx ? [{ to: "COMPLETED" as const, label: "Complete" }] : []),
      ];
    case "AWAITING_PHARMACY":
      // Dispensing closes the visit by itself; "Complete" here is for a patient who left.
      return [
        { to: "IN_CONSULTATION", label: "Back to doctor" },
        ...(!lab ? [{ to: "COMPLETED" as const, label: rx ? "Close: patient left" : "Complete", primary: !rx }] : []),
      ];
    default:
      return [];
  }
}

function VisitRow({ v, role, returnTo, prepayment, lang, doctors }: { v: QueueVisit; role: Role; returnTo: string; prepayment: boolean; lang: Lang; doctors: Doctor[] }) {
  const age = ageText(v.patient.dateOfBirth, true);
  // An emergency (triaged red) is seen before paying; the fee stays owed.
  const emergency = v.triageLevel === "RED";
  const feeOwed = prepayment && v.status === "WAITING" && v.consultationPaid === false;
  const unpaid = feeOwed && !emergency;
  const canTransfer = v.status === "WAITING" && (FRONT_DESK.includes(role) || role === "DOCTOR") && doctors.length > (v.doctor ? 1 : 0);
  const steps = CLINICAL.includes(role) ? nextSteps(v, unpaid) : [];
  const canCancel = v.status === "WAITING" && role !== "CASHIER" && role !== "PHARMACIST" && role !== "LAB_TECH";
  const small = "px-3 py-1.5 text-xs";
  const finished = v.status === "COMPLETED" || v.status === "CANCELLED";

  return (
    <StaggerItem className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-slate-50/70 sm:px-5 dark:hover:bg-slate-800/30">
      <span
        aria-label={`Queue number ${v.queueNumber}`}
        className={`grid size-12 shrink-0 place-items-center rounded-xl text-lg font-semibold tabular-nums ring-1 ring-inset ${
          finished
            ? "bg-slate-50 text-slate-400 ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-700"
            : "bg-brand-50 text-brand-800 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-400/20"
        }`}
      >
        {v.queueNumber}
      </span>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/patients/${v.patient.id}`} className="font-semibold text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300">
            {fullName(v.patient)}
          </Link>
          <span className="text-xs text-slate-500">
            {v.patient.mrn} · {v.patient.sex === "MALE" ? "M" : "F"}
            {age !== null && ` · ${age}`}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
          {/* Triage priority: the queue is ordered by it, emergencies first. */}
          {v.triageLevel && v.status !== "COMPLETED" && v.status !== "CANCELLED" && (
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TRIAGE[v.triageLevel].tone}`}>{tr(lang, TRIAGE[v.triageLevel].label)}</span>
          )}
          {v.status !== "WAITING" && <StatusBadge status={v.status} lang={lang} />}
          {v.carriedOver && <Badge tone="warning">Open since {formatDualDate(v.checkedInAt)}</Badge>}
          {unpaid && <Badge tone="danger">{tr(lang, "Awaiting payment")}</Badge>}
          {feeOwed && emergency && <Badge tone="warning">{tr(lang, "Emergency: pays after")}</Badge>}
          {(v.status === "AWAITING_LAB" || v.status === "AWAITING_PHARMACY") && v.labReady && (
            <Badge tone="success">
              <CircleCheck aria-hidden className="size-3" />
              {tr(lang, "Results ready")}
            </Badge>
          )}
          {v.status !== "AWAITING_LAB" && v.labPending && <Badge tone="info">{tr(lang, "Lab results pending")}</Badge>}
          {v.labAlert === "CRITICAL" && <Badge tone="danger">{tr(lang, "Critical lab result")}</Badge>}
          {v.labAlert === "AMENDED" && <Badge tone="warning">{tr(lang, "Lab result corrected")}</Badge>}
          {v.labRecollect && <Badge tone="warning">{tr(lang, "New lab sample needed")}</Badge>}
          {Number(v.owed ?? 0) > 0 && <Badge tone="danger">{tr(lang, "Owes")} {etb(v.owed!)}</Badge>}
          {v.status === "IN_CONSULTATION" && !v.diagnosed && CLINICAL.includes(role) && <Badge>{tr(lang, "No diagnosis yet")}</Badge>}
          <span>Arrived {formatTime(v.checkedInAt)}</span>
          {v.status === "WAITING" && (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
              <Clock aria-hidden className="size-3" />
              waiting {formatDuration(v.checkedInAt)}
            </span>
          )}
          {v.doctor && (
            <span>
              Dr. {v.doctor.fullName}
              {v.doctor.room && <span className="font-medium text-slate-700 dark:text-slate-200"> · {v.doctor.room}</span>}
            </span>
          )}
          {v.patient.allergies.length > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-400">
              <TriangleAlert aria-hidden className="size-3" />
              Allergies: {v.patient.allergies.join(", ")}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {CLINICAL.includes(role) && v.status !== "CANCELLED" && (
          <Link href={`/visits/${v.id}`} className={`${secondaryButtonClass} ${small}`}>
            {tr(lang, v.status === "WAITING" && role === "NURSE" ? "Triage" : "Open")}
          </Link>
        )}
        {steps.map((s) => (
          // Calling a patient in takes the doctor straight to the consultation screen.
          <form key={s.to} action={moveVisit.bind(null, v.id, s.to, s.to === "IN_CONSULTATION" ? `/visits/${v.id}` : returnTo)}>
            <button className={`${s.primary ? buttonClass : secondaryButtonClass} ${small}`}>{tr(lang, s.label)}</button>
          </form>
        ))}
        {canTransfer && (
          <TransferDoctor action={transferVisit.bind(null, v.id, returnTo)} doctors={doctors} currentId={v.doctor?.id ?? null} label={tr(lang, "Change doctor")} move={tr(lang, "Move")} keep={tr(lang, "Keep")} />
        )}
        {canCancel && (
          <CancelVisit
            action={cancelVisit.bind(null, v.id, returnTo)}
            label={tr(lang, "Cancel")}
            question={tr(lang, "Cancel this visit?")}
            yes={tr(lang, "Yes, cancel")}
            no={tr(lang, "Keep")}
            reasons={CANCEL_REASONS.map((r) => ({ value: r.value, label: tr(lang, r.label) }))}
          />
        )}
      </div>
    </StaggerItem>
  );
}

function Column({
  title,
  visits,
  empty,
  role,
  returnTo,
  prepayment,
  lang,
  doctors,
}: {
  title: string;
  visits: QueueVisit[];
  empty: string;
  role: Role;
  returnTo: string;
  prepayment: boolean;
  lang: Lang;
  doctors: Doctor[];
}) {
  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5 dark:border-slate-800">
        <h2 className="font-semibold text-slate-900 dark:text-white">{tr(lang, title)}</h2>
        <Badge tone={visits.length ? "brand" : "neutral"}>{visits.length}</Badge>
      </header>
      {visits.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">{tr(lang, empty)}</p>
      ) : (
        <StaggerList className="divide-y divide-slate-100 dark:divide-slate-800">
          {visits.map((v) => (
            <VisitRow key={v.id} v={v} role={role} returnTo={returnTo} prepayment={prepayment} lang={lang} doctors={doctors} />
          ))}
        </StaggerList>
      )}
    </section>
  );
}

async function CheckInPanel({ find, doctors, services, lang }: { find: string; doctors: Doctor[]; services: Service[]; lang: Lang }) {
  // With what each owes from earlier visits, to ask for at check-in.
  const matches = find ? await api<Patient[]>(`/patients?q=${encodeURIComponent(find)}&take=8&balance=1`) : [];
  return (
    <section className="surface mb-6 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">{tr(lang, "Check in a patient")}</h2>
        <Link href="/patients/new" className={`${linkClass} inline-flex items-center gap-1 text-sm`}>
          <UserPlus aria-hidden className="size-4" />
          {tr(lang, "New patient")}
        </Link>
      </div>
      <Form action="/queue" className="flex gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input name="find" defaultValue={find} placeholder="Name, phone or MRN" aria-label="Find patient" className={`${inputClass} pl-9`} />
        </div>
        <button className={secondaryButtonClass}>{tr(lang, "Find")}</button>
      </Form>
      {find && (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {matches.length === 0 && (
            <li className="py-3 text-sm text-slate-500">
              No match.{" "}
              <Link href="/patients/new" className={linkClass}>
                Register a new patient
              </Link>
            </li>
          )}
          {matches.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <span className="font-medium">{fullName(p)}</span>
                <span className="text-sm text-slate-500">
                  {" "}· {p.mrn}
                  {p.phone && ` · ${p.phone}`}
                </span>
                {p.balance && Number(p.balance.earlier) > 0 && (
                  <span className="ml-2">
                    <Badge tone="warning">
                      {tr(lang, "Owes")} {etb(p.balance.earlier)} {tr(lang, "from earlier visits")}
                    </Badge>
                  </span>
                )}
              </div>
              <CheckInForm patientId={p.id} doctors={doctors} services={services} coverages={p.coverages} returnTo="/queue" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Queue({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const lang = await getLang();
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
  const longest = waiting.reduce<string | null>((min, v) => (!min || v.checkedInAt < min ? v.checkedInAt : min), null);
  const filterLink = (value: string | undefined, label: string) => {
    const on = params.doctor === value;
    return (
      <Link
        key={label}
        href={value ? `/queue?doctor=${value}` : "/queue"}
        aria-current={on ? "page" : undefined}
        className={pillClass(on)}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title={tr(lang, "Queue")}
        subtitle={`${lang === "am" ? "" : "ወረፋ · "}${formatDualDate(`${day}T12:00:00+03:00`)}`}
        actions={
          <Link href="/display" target="_blank" className={secondaryButtonClass}>
            <ExternalLink aria-hidden />
            {tr(lang, "Waiting-room display")}
          </Link>
        }
      />
      <AutoRefresh seconds={15} />
      <Flash params={params} />

      <p className="mb-5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600 sm:hidden dark:text-slate-300">
        <span>
          <strong className="text-slate-900 tabular-nums dark:text-white">{waiting.length}</strong> {tr(lang, "Waiting").toLowerCase()}
          {longest && ` · longest ${formatDuration(longest)}`}
        </span>
        <span>
          <strong className="text-slate-900 tabular-nums dark:text-white">{active.length}</strong> {tr(lang, "In progress").toLowerCase()}
        </span>
        <span>
          <strong className="text-slate-900 tabular-nums dark:text-white">{done.filter((v) => v.status === "COMPLETED").length}</strong> {tr(lang, "Finished").toLowerCase()}
        </span>
      </p>
      <div className="mb-6 hidden grid-cols-2 gap-3 sm:grid lg:grid-cols-4">
        <StatCard
          label={tr(lang, "Patients today")}
          value={visits.filter((v) => !v.carriedOver).length}
          hint={visits.some((v) => v.carriedOver) ? `+ ${visits.filter((v) => v.carriedOver).length} open from earlier days` : undefined}
          icon={Users}
        />
        <StatCard label={tr(lang, "Waiting")} value={waiting.length} hint={longest ? `Longest: ${formatDuration(longest)}` : "Nobody waiting"} icon={Clock} />
        <StatCard label={tr(lang, "In progress")} value={active.length} hint="Doctor, lab or pharmacy" />
        <StatCard label={tr(lang, "Finished")} value={done.filter((v) => v.status === "COMPLETED").length} icon={CircleCheck} />
      </div>

      {FRONT_DESK.includes(me.role) && <CheckInPanel find={params.find?.trim() ?? ""} doctors={doctors} services={services} lang={lang} />}

      {doctors.length > 0 && (
        <nav aria-label="Filter by doctor" className="mb-4 flex flex-wrap gap-2">
          {filterLink(undefined, tr(lang, "All doctors"))}
          {me.role === "DOCTOR" && filterLink("me", tr(lang, "My patients"))}
          {doctors.filter((d) => d.id !== me.id).map((d) => filterLink(d.id, `Dr. ${d.fullName}`))}
        </nav>
      )}

      <div className="space-y-6">
        <Column title="Waiting" visits={waiting} empty="Nobody is waiting." role={me.role} returnTo={returnTo} prepayment={prepayment} lang={lang} doctors={doctors} />
        <Column title="In progress" visits={active} empty="No patient is with a doctor, at the lab or at the pharmacy." role={me.role} returnTo={returnTo} prepayment={prepayment} lang={lang} doctors={doctors} />
        {done.length > 0 && (
          <details className="group surface overflow-hidden">
            <summary className="flex items-center justify-between px-4 py-3 font-semibold text-slate-900 sm:px-5 dark:text-white">
              {tr(lang, "Finished today")}
              <span className="flex items-center gap-2">
                <Badge>{done.length}</Badge>
                <ChevronDown aria-hidden className="size-4 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
              </span>
            </summary>
            <StaggerList className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {done.map((v) => (
                <VisitRow key={v.id} v={v} role={me.role} returnTo={returnTo} prepayment={prepayment} lang={lang} doctors={doctors} />
              ))}
            </StaggerList>
          </details>
        )}
      </div>
    </>
  );
}

export default function QueuePage({ searchParams }: PageProps<"/queue">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-12 max-w-xs" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      }
    >
      <Queue searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}

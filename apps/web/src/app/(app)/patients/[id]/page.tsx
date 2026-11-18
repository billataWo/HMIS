import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CheckInForm } from "@/components/check-in-form";
import { CoverageSection } from "@/components/coverage-section";
import { Flash } from "@/components/flash";
import { AllergyAlert } from "@/components/allergy-alert";
import { AllergyEditor } from "@/components/allergy-editor";
import { canRegister, FRONT_DESK } from "@/lib/roles";
import { StatusBadge } from "@/components/status-badge";
import { Badge, linkClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { LabHistory } from "@/components/lab-history";
import { ProblemList } from "@/components/problem-list";
import { ReturnForm } from "@/components/return-form";
import { api, ApiError, type Appointment, type Doctor, type LabHistoryOrder, type Me, type Medication, type PatientBalance, type PatientCoverage, type FpView, type ImmunizationRecord, type Pregnancy, type PatientProblem, type PatientDetail, type Payer, type QueueVisit, type Service } from "@/lib/api";
import { shortDirections } from "@/lib/directions";
import { ageText, clinicToday, etb, formatDualDate, formatTime, fullName, ageParts } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { formatAddress } from "@/lib/address";
import { ImmunizationCard } from "@/components/immunization-card";
import { AncSection } from "@/components/anc-section";
import { FpSection } from "@/components/fp-section";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2">{children}</dd>
    </div>
  );
}

type PayerOption = Pick<Payer, "id" | "name" | "type"> & { coPayPercent: string; requiresAuthorization: boolean };

async function Patient({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkedIn?: string; error?: string; done?: string }>;
}) {
  const [{ id }, flash, t] = await Promise.all([params, searchParams, getT()]);
  let p: PatientDetail;
  try {
    p = await api<PatientDetail>(`/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  // A duplicate merged away: its MRN or an old link leads to the record it was merged into.
  if (p.mergedIntoId) redirect(`/patients/${p.mergedIntoId}`);
  const [me, upcoming, doctors, services, queue] = await Promise.all([
    api<Me>("/auth/me"),
    api<Appointment[]>(`/appointments?patientId=${p.id}`),
    api<Doctor[]>("/lookups/doctors"),
    api<Service[]>("/lookups/services"),
    api<{ visits: QueueVisit[] }>("/queue"),
  ]);
  const today = clinicToday();
  const todaysAppt = upcoming.find((a) => clinicToday(new Date(a.scheduledAt)) === today);
  const inQueue = queue.visits.find((v) => v.patient.id === p.id && !["COMPLETED", "CANCELLED"].includes(v.status));
  const canCheckIn = FRONT_DESK.includes(me.role);
  const canBook = canCheckIn || me.role === "DOCTOR";
  const canOpenVisits = ["ADMIN", "DOCTOR", "NURSE"].includes(me.role);
  const canEditAllergies = me.role === "DOCTOR" || me.role === "NURSE";
  const canDispense = me.role === "ADMIN" || me.role === "PHARMACIST";
  // Medication history: for the people who prescribe and dispense.
  const meds = ["ADMIN", "DOCTOR", "NURSE", "PHARMACIST"].includes(me.role) ? await api<Medication[]>(`/patients/${p.id}/medications`) : null;
  // Lab history: for clinicians and the lab.
  const labs = ["ADMIN", "DOCTOR", "NURSE", "LAB_TECH"].includes(me.role) ? await api<LabHistoryOrder[]>(`/patients/${p.id}/lab-results`) : null;
  // Long-term conditions: for clinicians.
  const problems = ["ADMIN", "DOCTOR", "NURSE"].includes(me.role) ? await api<PatientProblem[]>(`/patients/${p.id}/problems`) : null;
  // Vaccinations: worked out from the birth date; given by nurses and doctors, seen by the front desk.
  const immunization = ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"].includes(me.role) ? await api<ImmunizationRecord>(`/patients/${p.id}/immunizations`) : null;
  // Antenatal care: women of childbearing age (or of unknown age).
  const ageYears = p.dateOfBirth ? ageParts(p.dateOfBirth).years : null;
  const ancAge = p.sex === "FEMALE" && (ageYears === null || (ageYears >= 10 && ageYears <= 55));
  const pregnancies = ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"].includes(me.role) && p.sex === "FEMALE" ? await api<Pregnancy[]>(`/patients/${p.id}/pregnancies`) : [];
  // Family planning: anyone from 10 years (or of unknown age); men too (condoms, vasectomy).
  const fpAge = ageYears === null || ageYears >= 10;
  const fp = ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"].includes(me.role) && fpAge ? await api<FpView>(`/patients/${p.id}/family-planning`) : null;
  const canRequestLab = canCheckIn || me.role === "LAB_TECH";
  // Who pays for the patient (credit company or insurer): kept by the front desk and the cashier.
  const seesCoverage = ["ADMIN", "RECEPTIONIST", "NURSE", "CASHIER", "DOCTOR"].includes(me.role);
  const [coverages, payers] = seesCoverage
    ? await Promise.all([api<PatientCoverage[]>(`/patients/${p.id}/coverages`), api<PayerOption[]>("/lookups/payers")])
    : [[], []];
  // Money owed from earlier visits: asked for at check-in, before it builds up.
  const balance = ["ADMIN", "RECEPTIONIST", "NURSE", "CASHIER"].includes(me.role) ? await api<PatientBalance>(`/patients/${p.id}/balance`) : null;
  const age = ageText(p.dateOfBirth, false, t);

  return (
    <>
      <PageHeader
        title={fullName(p)}
        subtitle={[p.mrn, [p.firstNameAm, p.fatherNameAm].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            {canBook && (
              <Link href={`/appointments/new?patientId=${p.id}`} className={secondaryButtonClass}>
                {t("Book appointment")}
              </Link>
            )}
            {canRequestLab && (
              <Link href={`/lab/request?patientId=${p.id}`} className={secondaryButtonClass}>
                {t("Lab tests only")}
              </Link>
            )}
            {canRegister(me) && (
              <Link href={`/patients/${p.id}/edit`} className={secondaryButtonClass}>
                {t("Edit details")}
              </Link>
            )}
            {canRegister(me) && (
              <Link href={`/patients/new?relativeOf=${p.id}`} className={secondaryButtonClass}>
                {t("Add family member")}
              </Link>
            )}
            <Link href={`/patient-card/${p.id}`} target="_blank" className={secondaryButtonClass}>
              {t("Patient card")}
            </Link>
            {me.role === "ADMIN" && (
              <Link href={`/patients/${p.id}/merge`} className={secondaryButtonClass}>
                {t("Merge a duplicate")}
              </Link>
            )}
            {me.role === "ADMIN" && (
              // A download (the right of access): a plain link, not a page change.
              <a href={`/patients/${p.id}/export`} className={secondaryButtonClass}>
                {t("Export record")}
              </a>
            )}
          </div>
        }
      />

      <Flash params={flash} />
      {balance && Number(balance.earlier) > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
          <p className="font-medium">{t("Owes {amount} from earlier visits", { amount: etb(balance.earlier, t) })}</p>
          <p className="mt-1 text-xs">
            {balance.visits
              .filter((v) => clinicToday(new Date(v.checkedInAt)) !== clinicToday())
              .map((v) => `${formatDualDate(v.checkedInAt)}: ${etb(v.owed, t)}`)
              .join(" · ")}
            . {t("Ask the patient to settle it at the cashier.")}
          </p>
        </div>
      )}
      <section className="mb-6 surface p-4 dark:border-slate-800">
        {inQueue ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-lg font-semibold tabular-nums text-brand-800 ring-1 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-200">
              {inQueue.queueNumber}
            </span>
            <span>{t("In today's queue")}</span>
            <StatusBadge status={inQueue.status} lang={t.lang} />
            <Link href="/queue" className={`${linkClass} ml-auto`}>
              {t("Open queue")}
            </Link>
          </div>
        ) : canCheckIn ? (
          <>
            <h2 className="mb-2 font-medium">
              {t("Check in for today")}
              {todaysAppt && <span className="font-normal text-slate-500"> · {t("appointment at {time}", { time: formatTime(todaysAppt.scheduledAt) })}</span>}
            </h2>
            <CheckInForm
              patientId={p.id}
              appointmentId={todaysAppt?.id}
              defaultDoctorId={todaysAppt?.doctor?.id}
              doctors={doctors}
              services={services}
              coverages={coverages.filter((c) => c.active)}
              returnTo={`/patients/${p.id}`}
            />
          </>
        ) : (
          <p className="text-sm text-slate-500">{t("Not in today's queue.")}</p>
        )}
        {upcoming.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
            <h3 className="mb-1 font-medium">{t("Upcoming appointments")}</h3>
            <ul>
              {upcoming.map((a) => (
                <li key={a.id}>
                  {t("{date} at {time}", { date: formatDualDate(a.scheduledAt), time: formatTime(a.scheduledAt) })}
                  {a.doctor && ` · ${t("Dr. {name}", { name: a.doctor.fullName })}`}
                  {a.reason && <span className="text-slate-500"> · {a.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {seesCoverage && (coverages.length > 0 || payers.length > 0) && (
        <div className="mb-6">
          <CoverageSection patientId={p.id} coverages={coverages} payers={payers} canEdit={me.role !== "DOCTOR"} />
        </div>
      )}

      <AllergyAlert allergies={p.allergies} className={canEditAllergies ? "mb-2" : "mb-6"} />
      {canEditAllergies && (
        <div className="mb-6">
          <AllergyEditor patientId={p.id} allergies={p.allergies} />
        </div>
      )}

      {(ancAge || pregnancies.length > 0) && ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"].includes(me.role) && (
        <div className="mb-6">
          <AncSection patientId={p.id} pregnancies={pregnancies} canEdit={me.role === "DOCTOR" || me.role === "NURSE"} />
        </div>
      )}
      {fp && (
        <div className="mb-6">
          <FpSection patientId={p.id} sex={p.sex} view={fp} canEdit={me.role === "DOCTOR" || me.role === "NURSE"} />
        </div>
      )}
      {immunization && (immunization.schedule.length > 0 || immunization.doses.length > 0) && (
        <div className="mb-6">
          <ImmunizationCard patientId={p.id} record={immunization} canGive={me.role === "DOCTOR" || me.role === "NURSE"} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface p-4 dark:border-slate-800">
          <h2 className="mb-2 font-medium">{t("Details")}</h2>
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row label={t("Sex")}>{t(p.sex === "MALE" ? "Male · ወንድ" : "Female · ሴት")}</Row>
            <Row label={t("Age")}>
              {age !== null ? `${age}` : "—"}
              {p.dateOfBirth && (
                <span className="block text-xs text-slate-500">
                  {p.dobEstimated ? t("Estimated from the age given") : t("Born {date}", { date: formatDualDate(p.dateOfBirth) })}
                </span>
              )}
            </Row>
            <Row label={t("Phone")}>{p.phone ?? "—"}</Row>
            <Row label={t("Address")}>{formatAddress(p, t) ?? "—"}</Row>
            {p.nationalId && <Row label={t("National ID")}>{p.nationalId}</Row>}
            <Row label={t("Next of kin")}>
              {p.nextOfKinName ? (
                <>
                  {p.nextOfKinName}
                  {p.nextOfKinRelation && ` (${p.nextOfKinRelation})`}
                  {p.nextOfKinPhone && <span className="block text-xs text-slate-500">{p.nextOfKinPhone}</span>}
                </>
              ) : (
                "—"
              )}
            </Row>
            <Row label={t("Registered")}>{formatDualDate(p.createdAt)}</Row>
          </dl>
        </section>

        <section className="surface p-4 dark:border-slate-800">
          <h2 className="mb-2 font-medium">{t("Family")}</h2>
          {p.family.length === 0 ? (
            <p className="text-sm text-slate-500">{t("No linked family members.")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {p.family.map((f) => (
                <li key={f.id} className="py-2">
                  <Link href={`/patients/${f.id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                    {fullName(f)}
                  </Link>
                  <span className="text-slate-500">
                    {" "}· {f.mrn} · {t(f.sex === "MALE" ? "M" : "F")}
                    {ageText(f.dateOfBirth, true) && ` · ${ageText(f.dateOfBirth, true, t)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface p-4 lg:col-span-2 dark:border-slate-800">
          <h2 className="mb-2 font-medium">{t("Visit history")}</h2>
          {p.visits.length === 0 ? (
            <p className="text-sm text-slate-500">{t("No visits yet.")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {p.visits.map((v) => (
                <li key={v.id} className="py-2">
                  {canOpenVisits && v.kind === "OPD" ? (
                    <Link href={`/visits/${v.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                      {formatDualDate(v.checkedInAt)}
                    </Link>
                  ) : (
                    <span className="font-medium">{formatDualDate(v.checkedInAt)}</span>
                  )}
                  <span className="ml-2">
                    {v.kind === "WALK_IN" ? <Badge tone="violet">{t("Pharmacy sale")}</Badge> : v.kind === "LAB" ? <Badge tone="info">{t("Lab only")}</Badge> : <StatusBadge status={v.status} lang={t.lang} />}
                  </span>
                  {v.doctor && <span className="text-slate-500"> · {t("Dr. {name}", { name: v.doctor.fullName })}</span>}
                  {v.chiefComplaint && <span className="block">{v.chiefComplaint}</span>}
                  {v.diagnoses && v.diagnoses.length > 0 && (
                    <span className="block text-slate-500">{v.diagnoses.map((d) => `${d.label} (${d.icd11Code})`).join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {problems && (
          <div className="lg:col-span-2">
            <ProblemList patientId={p.id} problems={problems} canEdit={me.role === "DOCTOR"} />
          </div>
        )}
        {labs && <LabHistory history={labs} />}
        {meds && <Medications meds={meds} dispenses={canDispense} canOpenInvoices={me.role === "ADMIN"} t={t} />}
      </div>
    </>
  );
}

const RX_STATUS: Record<Medication["status"], string> = {
  PENDING: "Waiting at pharmacy",
  PARTIALLY_DISPENSED: "Partly dispensed",
  DISPENSED: "Dispensed",
  CANCELLED: "Cancelled",
};

/** Every prescription and counter sale, newest first: what was given and what came back. */
function Medications({ meds, dispenses, canOpenInvoices, t }: { meds: Medication[]; dispenses: boolean; canOpenInvoices: boolean; t: T }) {
  return (
    <section id="medications" className="surface scroll-mt-6 p-4 lg:col-span-2 dark:border-slate-800">
      <h2 className="mb-2 font-medium">{t("Medications")}</h2>
      {meds.length === 0 ? (
        <p className="text-sm text-slate-500">{t("Nothing prescribed or sold yet.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {meds.map((m) => (
            <li key={m.id} className={`py-3 ${m.status === "CANCELLED" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{formatDualDate(m.createdAt)}</span>
                  <span className="text-slate-500">
                    {" "}· {m.visit.kind === "WALK_IN" ? t("counter sale by {name}", { name: m.prescriber.fullName }) : t("Dr. {name}", { name: m.prescriber.fullName })} · {t(RX_STATUS[m.status])}
                  </span>
                </span>
                {dispenses && m.status !== "CANCELLED" && (
                  <Link href={`/rx-label/${m.id}`} target="_blank" className="text-xs text-brand-700 hover:underline dark:text-brand-400">
                    {t("Print labels")}
                  </Link>
                )}
              </div>
              <ul className="mt-1 space-y-1.5">
                {m.items.map((i) => {
                  const withPatient = i.dispensedQty - i.returnedQty;
                  return (
                    <li key={i.id}>
                      <span className={m.status === "CANCELLED" ? "line-through" : ""}>
                        <span className="font-medium">
                          {i.drug.genericName} {i.drug.strength} {i.drug.form}
                        </span>{" "}
                        · {shortDirections(i, t)} · {t("qty {n}", { n: i.quantity })}
                      </span>
                      {m.status !== "CANCELLED" && (
                        <span className="text-xs text-slate-500">
                          {" "}· {t("given {n}", { n: i.dispensedQty })}
                          {i.returnedQty > 0 && <span className="font-medium text-amber-700 dark:text-amber-400"> · {t("{n} returned", { n: i.returnedQty })}</span>}
                        </span>
                      )}
                      {i.instructions && <span className="block text-xs text-slate-500">{i.instructions}</span>}
                      {i.substitutedFrom && (
                        <span className="block text-xs text-amber-800 dark:text-amber-300">
                          {t("Pharmacy gave this instead of {drug}", { drug: i.substitutedFrom })}
                          {i.substitutionReason && `: ${i.substitutionReason}`}
                        </span>
                      )}
                      {dispenses && withPatient > 0 && (
                        <div>
                          <ReturnForm itemId={i.id} drug={i.drug.genericName} unit={i.drug.unit} withPatient={withPatient} canOpenInvoices={canOpenInvoices} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PatientPage({ params, searchParams }: PageProps<"/patients/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Patient params={params} searchParams={searchParams as Promise<{ checkedIn?: string; error?: string }>} />
    </Suspense>
  );
}

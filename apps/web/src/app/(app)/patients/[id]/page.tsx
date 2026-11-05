import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckInForm } from "@/components/check-in-form";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Appointment, type Doctor, type Me, type PatientDetail, type QueueVisit, type Service } from "@/lib/api";
import { ageFrom, clinicToday, formatDualDate, formatTime, fullName } from "@/lib/format";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="col-span-2">{children}</dd>
    </div>
  );
}

async function Patient({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkedIn?: string; error?: string }>;
}) {
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  let p: PatientDetail;
  try {
    p = await api<PatientDetail>(`/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
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
  const canCheckIn = ["ADMIN", "RECEPTIONIST", "NURSE"].includes(me.role);
  const canBook = canCheckIn || me.role === "DOCTOR";
  const canOpenVisits = ["ADMIN", "DOCTOR", "NURSE"].includes(me.role);
  const age = ageFrom(p.dateOfBirth);

  return (
    <>
      <PageHeader
        title={fullName(p)}
        subtitle={[p.mrn, [p.firstNameAm, p.fatherNameAm].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            {canBook && (
              <Link href={`/appointments/new?patientId=${p.id}`} className={secondaryButtonClass}>
                Book appointment
              </Link>
            )}
            <Link href={`/patients/new?relativeOf=${p.id}`} className={secondaryButtonClass}>
              Add family member
            </Link>
          </div>
        }
      />

      <Flash params={flash} />
      <section className="mb-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        {inQueue ? (
          <p className="text-sm">
            In today&apos;s queue as <strong className="text-lg">number {inQueue.queueNumber}</strong> · <StatusBadge status={inQueue.status} />{" "}
            <Link href="/queue" className="text-teal-700 underline dark:text-teal-400">
              Open queue
            </Link>
          </p>
        ) : canCheckIn ? (
          <>
            <h2 className="mb-2 font-medium">
              Check in for today
              {todaysAppt && <span className="font-normal text-zinc-500"> · appointment at {formatTime(todaysAppt.scheduledAt)}</span>}
            </h2>
            <CheckInForm
              patientId={p.id}
              appointmentId={todaysAppt?.id}
              defaultDoctorId={todaysAppt?.doctor?.id}
              doctors={doctors}
              services={services}
              returnTo={`/patients/${p.id}`}
            />
          </>
        ) : (
          <p className="text-sm text-zinc-500">Not in today&apos;s queue.</p>
        )}
        {upcoming.length > 0 && (
          <div className="mt-4 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
            <h3 className="mb-1 font-medium">Upcoming appointments</h3>
            <ul>
              {upcoming.map((a) => (
                <li key={a.id}>
                  {formatDualDate(a.scheduledAt)} at {formatTime(a.scheduledAt)}
                  {a.doctor && ` · Dr. ${a.doctor.fullName}`}
                  {a.reason && <span className="text-zinc-500"> · {a.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {p.allergies.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <strong>Allergies:</strong> {p.allergies.join(", ")}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-2 font-medium">Details</h2>
          <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Row label="Sex">{p.sex === "MALE" ? "Male · ወንድ" : "Female · ሴት"}</Row>
            <Row label="Age">
              {age !== null ? `${age} years` : "—"}
              {p.dateOfBirth && <span className="block text-xs text-zinc-500">Born {formatDualDate(p.dateOfBirth)}</span>}
            </Row>
            <Row label="Phone">{p.phone ?? "—"}</Row>
            <Row label="Address">{p.address ?? "—"}</Row>
            <Row label="Registered">{formatDualDate(p.createdAt)}</Row>
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-2 font-medium">Family</h2>
          {p.family.length === 0 ? (
            <p className="text-sm text-zinc-500">No linked family members.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {p.family.map((f) => (
                <li key={f.id} className="py-2">
                  <Link href={`/patients/${f.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                    {fullName(f)}
                  </Link>
                  <span className="text-zinc-500">
                    {" "}· {f.mrn} · {f.sex === "MALE" ? "M" : "F"}
                    {ageFrom(f.dateOfBirth) !== null && ` · ${ageFrom(f.dateOfBirth)}y`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 p-4 lg:col-span-2 dark:border-zinc-800">
          <h2 className="mb-2 font-medium">Visit history</h2>
          {p.visits.length === 0 ? (
            <p className="text-sm text-zinc-500">No visits yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {p.visits.map((v) => (
                <li key={v.id} className="py-2">
                  {canOpenVisits ? (
                    <Link href={`/visits/${v.id}`} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                      {formatDualDate(v.checkedInAt)}
                    </Link>
                  ) : (
                    <span className="font-medium">{formatDualDate(v.checkedInAt)}</span>
                  )}
                  <span className="ml-2">
                    <StatusBadge status={v.status} />
                  </span>
                  {v.doctor && <span className="text-zinc-500"> · Dr. {v.doctor.fullName}</span>}
                  {v.chiefComplaint && <span className="block">{v.chiefComplaint}</span>}
                  {v.diagnoses && v.diagnoses.length > 0 && (
                    <span className="block text-zinc-500">{v.diagnoses.map((d) => `${d.label} (${d.icd11Code})`).join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function PatientPage({ params, searchParams }: PageProps<"/patients/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Patient params={params} searchParams={searchParams as Promise<{ checkedIn?: string; error?: string }>} />
    </Suspense>
  );
}

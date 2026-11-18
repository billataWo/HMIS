import { Pill, Printer, ShieldAlert, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Flash } from "@/components/flash";
import { ReturnForm } from "@/components/return-form";
import { PageTitle } from "@/components/page-title";
import { Badge, buttonClass, EmptyState, secondaryButtonClass, Skeleton } from "@/components/ui";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { api, ApiError, type DrugReturnRow, type Me, type PharmacyPrescription } from "@/lib/api";
import { ageText, clinicToday, formatDualDate, formatDuration, formatTime, fullName } from "@/lib/format";
import { ClosePrescriptionForm, DispenseForm } from "./dispense-form";

function PatientLine({ p, t }: { p: PharmacyPrescription; t: T }) {
  const pt = p.visit.patient;
  const age = ageText(pt.dateOfBirth, true, t);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <Link href={`/patients/${pt.id}`} className="font-medium hover:underline">
          {fullName(pt)}
        </Link>
        <span className="text-sm text-slate-500">
          {" "}· {pt.mrn} · {t(pt.sex === "MALE" ? "M" : "F")}
          {age !== null && ` · ${age}`}
          {p.visit.kind === "WALK_IN" ? "" : ` · ${t("queue #{n}", { n: p.visit.queueNumber })}`}
        </span>
        {p.visit.kind === "WALK_IN" && (
          <span className="ml-2">
            <Badge tone="violet">{t("Walk-in sale")}</Badge>
          </span>
        )}
        {/* Left from an earlier day: hand it over, or close it if the patient isn't coming back. */}
        {clinicToday(new Date(p.createdAt)) < clinicToday() && (
          <span className="ml-2" title={t("Hand it over, or close it if the patient isn't coming back")}>
            <Badge tone="warning">{t("From {date}", { date: formatDualDate(p.createdAt) })}</Badge>
          </span>
        )}
      </div>
      <span className="text-xs text-slate-500">
        {p.visit.kind === "WALK_IN" ? t("Sold by {name}", { name: p.prescriber.fullName }) : t("Dr. {name}", { name: p.prescriber.fullName })} · {formatTime(p.createdAt)} ·{" "}
        {t("waiting {time}", { time: formatDuration(p.createdAt, undefined, t) })}
      </span>
    </div>
  );
}

async function Worklist() {
  let data: { prepayment: boolean; open: PharmacyPrescription[]; dispensedToday: PharmacyPrescription[]; returnsToday: DrugReturnRow[]; admin: boolean };
  const t = await getT();
  try {
    const [queue, me] = await Promise.all([
      api<Omit<typeof data, "admin">>("/pharmacy/queue"),
      api<Me>("/auth/me"),
    ]);
    data = { ...queue, admin: me.role === "ADMIN" };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only pharmacists and admins can dispense.")}</p>;
    throw e;
  }

  return (
    <div className="space-y-6">
      {data.open.length === 0 ? (
        <EmptyState icon={Pill} title={t("No prescriptions waiting")} />
      ) : (
        data.open.map((p) => (
          <section key={p.id} className="space-y-3 surface p-4 dark:border-slate-800">
            <PatientLine p={p} t={t} />
            {p.visit.patient.allergies.length > 0 && (
              <p className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-900 dark:bg-red-950 dark:text-red-100">
                {t("Allergies: {list}", { list: p.visit.patient.allergies.join(", ") })}
              </p>
            )}
            {p.alerts && p.alerts.length > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-medium">{t("Prescriber accepted these alerts:")}</p>
                <ul className="list-disc pl-5">
                  {p.alerts.map((a, i) => (
                    <li key={i}>{t(a.message)}</li>
                  ))}
                </ul>
                {p.overrideReason && <p className="mt-1">{t("Reason given: {reason}", { reason: p.overrideReason })}</p>}
              </div>
            )}
            <DispenseForm prescriptionId={p.id} items={p.items} prepayment={data.prepayment} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ClosePrescriptionForm prescriptionId={p.id} />
              <LabelsLink id={p.id} t={t} />
            </div>
          </section>
        ))
      )}

      {data.dispensedToday.length > 0 && (
        <details className="surface p-4 dark:border-slate-800">
          <summary className="cursor-pointer font-medium">
            {t("Dispensed today")} <span className="text-slate-500">({data.dispensedToday.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.dispensedToday.map((p) => (
              <li key={p.id} className="space-y-1 py-3">
                <PatientLine p={p} t={t} />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-slate-600 dark:text-slate-400">
                    {p.items.map((i) => `${i.drug.genericName} × ${i.dispensedQty}${i.returnedQty ? ` (${t("{n} returned", { n: i.returnedQty })})` : ""}`).join(", ")}
                    {p.dispensedAt && <span className="text-slate-500"> · {formatTime(p.dispensedAt)}</span>}
                  </p>
                  <LabelsLink id={p.id} t={t} />
                </div>
                {p.items
                  .filter((i) => i.dispensedQty - i.returnedQty > 0)
                  .map((i) => (
                    <ReturnForm
                      key={i.id}
                      itemId={i.id}
                      drug={i.drug.genericName}
                      unit={i.drug.unit}
                      withPatient={i.dispensedQty - i.returnedQty}
                      canOpenInvoices={data.admin}
                      label={t("Return {drug}", { drug: i.drug.genericName })}
                    />
                  ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.returnsToday.length > 0 && (
        <section className="surface p-4 dark:border-slate-800">
          <h2 className="mb-2 font-medium">
            {t("Returns today")} <span className="text-slate-500">({data.returnsToday.length})</span>
          </h2>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.returnsToday.map((r) => {
              const pt = r.prescriptionItem.prescription.visit.patient;
              const d = r.prescriptionItem.drug;
              return (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">
                      {d.genericName} {d.strength} × {r.quantity}
                    </span>{" "}
                    <Badge tone={r.restocked ? "success" : "warning"}>{t(r.restocked ? "Back on the shelf" : "For destruction")}</Badge>
                    <span className="block text-xs text-slate-500">{t(r.reason)}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    <Link href={`/patients/${pt.id}#medications`} className="hover:underline">
                      {fullName(pt)} · {pt.mrn}
                    </Link>{" "}
                    · {formatTime(r.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-xs text-slate-500">
        {t("A patient bringing back drugs from an earlier day? Open their record (Patients) and use “Record a return” under Medications.")}
      </p>
    </div>
  );
}

function LabelsLink({ id, t }: { id: string; t: T }) {
  return (
    <Link href={`/rx-label/${id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">
      <Printer aria-hidden className="size-3.5" />
      {t("Print labels")}
    </Link>
  );
}

async function Message({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  return <Flash params={await searchParams} />;
}

async function Actions() {
  const t = await getT();
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/inventory/controlled" className={secondaryButtonClass}>
        <ShieldAlert aria-hidden />
        {t("Controlled register")}
      </Link>
      <Link href="/pharmacy/walk-in" className={buttonClass}>
        <ShoppingBag aria-hidden />
        {t("Walk-in sale")}
      </Link>
    </div>
  );
}

export default function PharmacyPage({ searchParams }: PageProps<"/pharmacy">) {
  return (
    <>
      <PageTitle title="Pharmacy" subtitle="prescriptions to dispense" actions={<Actions />} />
      <AutoRefresh seconds={20} />
      <Suspense fallback={null}>
        <Message searchParams={searchParams as Promise<{ done?: string; error?: string }>} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Worklist />
      </Suspense>
    </>
  );
}

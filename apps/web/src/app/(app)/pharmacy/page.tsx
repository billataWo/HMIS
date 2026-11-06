import { Pill, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Flash } from "@/components/flash";
import { Badge, buttonClass, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type PharmacyPrescription } from "@/lib/api";
import { ageFrom, formatDuration, formatTime, fullName } from "@/lib/format";
import { ClosePrescriptionForm, DispenseForm } from "./dispense-form";

function PatientLine({ p }: { p: PharmacyPrescription }) {
  const pt = p.visit.patient;
  const age = ageFrom(pt.dateOfBirth);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <Link href={`/patients/${pt.id}`} className="font-medium hover:underline">
          {fullName(pt)}
        </Link>
        <span className="text-sm text-slate-500">
          {" "}· {pt.mrn} · {pt.sex === "MALE" ? "M" : "F"}
          {age !== null && ` · ${age}y`}
          {p.visit.kind === "WALK_IN" ? "" : ` · queue #${p.visit.queueNumber}`}
        </span>
        {p.visit.kind === "WALK_IN" && (
          <span className="ml-2">
            <Badge tone="violet">Walk-in sale</Badge>
          </span>
        )}
      </div>
      <span className="text-xs text-slate-500">
        {p.visit.kind === "WALK_IN" ? `Sold by ${p.prescriber.fullName}` : `Dr. ${p.prescriber.fullName}`} · {formatTime(p.createdAt)} · waiting {formatDuration(p.createdAt)}
      </span>
    </div>
  );
}

async function Worklist() {
  let data: { prepayment: boolean; open: PharmacyPrescription[]; dispensedToday: PharmacyPrescription[] };
  try {
    data = await api("/pharmacy/queue");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only pharmacists and admins can dispense.</p>;
    throw e;
  }

  return (
    <div className="space-y-6">
      {data.open.length === 0 ? (
        <EmptyState icon={Pill} title="No prescriptions waiting" />
      ) : (
        data.open.map((p) => (
          <section key={p.id} className="space-y-3 surface p-4 dark:border-slate-800">
            <PatientLine p={p} />
            {p.visit.patient.allergies.length > 0 && (
              <p className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-900 dark:bg-red-950 dark:text-red-100">
                Allergies: {p.visit.patient.allergies.join(", ")}
              </p>
            )}
            {p.alerts && p.alerts.length > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-medium">Prescriber accepted these alerts:</p>
                <ul className="list-disc pl-5">
                  {p.alerts.map((a, i) => (
                    <li key={i}>{a.message}</li>
                  ))}
                </ul>
                {p.overrideReason && <p className="mt-1">Reason given: {p.overrideReason}</p>}
              </div>
            )}
            <DispenseForm prescriptionId={p.id} items={p.items} prepayment={data.prepayment} />
            <ClosePrescriptionForm prescriptionId={p.id} />
          </section>
        ))
      )}

      {data.dispensedToday.length > 0 && (
        <details className="surface p-4 dark:border-slate-800">
          <summary className="cursor-pointer font-medium">
            Dispensed today <span className="text-slate-500">({data.dispensedToday.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.dispensedToday.map((p) => (
              <li key={p.id} className="py-2">
                <PatientLine p={p} />
                <p className="text-slate-600 dark:text-slate-400">
                  {p.items.map((i) => `${i.drug.genericName} × ${i.dispensedQty}`).join(", ")}
                  {p.dispensedAt && <span className="text-slate-500"> · {formatTime(p.dispensedAt)}</span>}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

async function Message({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  return <Flash params={await searchParams} />;
}

export default function PharmacyPage({ searchParams }: PageProps<"/pharmacy">) {
  return (
    <>
      <PageHeader
        title="Pharmacy"
        subtitle="ፋርማሲ · prescriptions to dispense"
        actions={
          <Link href="/pharmacy/walk-in" className={buttonClass}>
            <ShoppingBag aria-hidden />
            Walk-in sale
          </Link>
        }
      />
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

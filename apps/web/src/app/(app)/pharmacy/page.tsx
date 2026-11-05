import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type PharmacyPrescription } from "@/lib/api";
import { ageFrom, formatDuration, formatTime, fullName } from "@/lib/format";
import { DispenseForm } from "./dispense-form";

function PatientLine({ p }: { p: PharmacyPrescription }) {
  const pt = p.visit.patient;
  const age = ageFrom(pt.dateOfBirth);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <Link href={`/patients/${pt.id}`} className="font-medium hover:underline">
          {fullName(pt)}
        </Link>
        <span className="text-sm text-zinc-500">
          {" "}· {pt.mrn} · {pt.sex === "MALE" ? "M" : "F"}
          {age !== null && ` · ${age}y`} · queue #{p.visit.queueNumber}
        </span>
      </div>
      <span className="text-xs text-zinc-500">
        Dr. {p.prescriber.fullName} · {formatTime(p.createdAt)} · waiting {formatDuration(p.createdAt)}
      </span>
    </div>
  );
}

async function Worklist() {
  let data: { prepayment: boolean; open: PharmacyPrescription[]; dispensedToday: PharmacyPrescription[] };
  try {
    data = await api("/pharmacy/queue");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-zinc-500">Only pharmacists and admins can dispense.</p>;
    throw e;
  }

  return (
    <div className="space-y-6">
      {data.open.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No prescriptions waiting.
        </div>
      ) : (
        data.open.map((p) => (
          <section key={p.id} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
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
          </section>
        ))
      )}

      {data.dispensedToday.length > 0 && (
        <details className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">
            Dispensed today <span className="text-zinc-500">({data.dispensedToday.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {data.dispensedToday.map((p) => (
              <li key={p.id} className="py-2">
                <PatientLine p={p} />
                <p className="text-zinc-600 dark:text-zinc-400">
                  {p.items.map((i) => `${i.drug.genericName} × ${i.dispensedQty}`).join(", ")}
                  {p.dispensedAt && <span className="text-zinc-500"> · {formatTime(p.dispensedAt)}</span>}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function PharmacyPage() {
  return (
    <>
      <PageHeader title="Pharmacy" subtitle="ፋርማሲ · prescriptions to dispense" />
      <AutoRefresh seconds={20} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Worklist />
      </Suspense>
    </>
  );
}

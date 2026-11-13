import { ClipboardPlus, FlaskConical } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Flash } from "@/components/flash";
import { LabValue } from "@/components/lab-result";
import { Badge, buttonClass, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type LabWorkOrder } from "@/lib/api";
import { ageFrom, formatDuration, formatTime, fullName } from "@/lib/format";
import { AmendResult, BenchRow } from "./bench-row";

/** Groups a flat list of orders by visit, keeping the order of first appearance. */
function byVisit(orders: LabWorkOrder[]) {
  const groups = new Map<string, LabWorkOrder[]>();
  for (const o of orders) groups.set(o.visit.id, [...(groups.get(o.visit.id) ?? []), o]);
  return [...groups.values()];
}

async function Worklist() {
  let data: { prepayment: boolean; open: LabWorkOrder[]; verifiedToday: LabWorkOrder[] };
  try {
    data = await api("/lab/worklist");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only lab technicians and admins work the lab bench.</p>;
    throw e;
  }

  return (
    <div className="space-y-6">
      {data.open.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No tests waiting" />
      ) : (
        byVisit(data.open).map((group) => {
          const { visit, orderedBy, orderedAt } = group[0];
          const age = ageFrom(visit.patient.dateOfBirth);
          return (
            <section key={visit.id} className="surface p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-medium">{fullName(visit.patient)}</span>
                  <span className="text-sm text-slate-500">
                    {" "}· {visit.patient.mrn} · {visit.patient.sex === "MALE" ? "M" : "F"}
                    {age !== null && ` · ${age}y`}
                    {visit.kind === "LAB" ? "" : ` · queue #${visit.queueNumber}`}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {visit.kind === "LAB" ? `Lab-only request${group[0].requestedBy ? ` from ${group[0].requestedBy}` : ""}` : `Dr. ${orderedBy.fullName}`} · {formatTime(orderedAt)} · waiting{" "}
                  {formatDuration(orderedAt)}
                </span>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.map((o) => (
                  <BenchRow key={o.id} o={o} prepayment={data.prepayment} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {data.verifiedToday.length > 0 && (
        <details className="surface p-4 dark:border-slate-800">
          <summary className="cursor-pointer font-medium">
            Verified today <span className="text-slate-500">({data.verifiedToday.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.verifiedToday.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {fullName(o.visit.patient)} · {o.labTest.name}: <LabValue o={o} />
                </span>
                <span className="text-xs text-slate-500">
                  {o.amendedAt && <Badge tone="warning">Amended</Badge>} {o.verifiedAt && formatTime(o.verifiedAt)} ·{" "}
                  <Link href={`/lab-report/${o.visit.id}`} target="_blank" className="text-brand-700 hover:underline dark:text-brand-400">
                    Print
                  </Link>{" "}
                  · <AmendResult o={o} />
                </span>
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

export default function LabPage({ searchParams }: PageProps<"/lab">) {
  return (
    <>
      <PageHeader
        title="Laboratory"
        subtitle="ላብራቶሪ · samples and results"
        actions={
          <Link href="/lab/request?from=lab" className={buttonClass}>
            <ClipboardPlus aria-hidden />
            Lab-only request
          </Link>
        }
      />
      <Suspense fallback={null}>
        <Message searchParams={searchParams as Promise<{ done?: string; error?: string }>} />
      </Suspense>
      <AutoRefresh seconds={20} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Worklist />
      </Suspense>
    </>
  );
}

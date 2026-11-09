import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, EmptyState, PageHeader, pillClass, Skeleton } from "@/components/ui";
import { type ClinicRequest, DEPLOYMENT_LABEL, platformApi } from "@/lib/platform";
import { dateTime, tdClass, thClass } from "../bits";

const STATUS = { PENDING: { label: "Waiting", tone: "warning" }, APPROVED: { label: "Approved", tone: "success" }, REJECTED: { label: "Rejected", tone: "neutral" } } as const;

async function List({ status }: { status: string }) {
  const requests = await platformApi<ClinicRequest[]>(`/platform/requests${status ? `?status=${status}` : ""}`);
  if (!requests.length) return <EmptyState title="No requests">{status === "PENDING" ? "Nothing is waiting for a decision." : null}</EmptyState>;
  return (
    <Card className="overflow-x-auto">
      <table className="-m-5 w-[calc(100%+2.5rem)] text-sm">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <th className={thClass}>Clinic</th>
            <th className={thClass}>Where</th>
            <th className={thClass}>Contact</th>
            <th className={thClass}>Wants</th>
            <th className={thClass}>Sent</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {requests.map((r) => (
            <tr key={r.id}>
              <td className={tdClass}>
                <Link href={`/platform/requests/${r.id}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                  {r.clinicName}
                </Link>
                <p className="font-mono text-xs text-slate-500">{r.reference}</p>
              </td>
              <td className={tdClass}>
                {r.city}, {r.region}
              </td>
              <td className={tdClass}>
                {r.contactName}
                <p className="text-xs text-slate-500">{r.contactPhone}</p>
              </td>
              <td className={tdClass}>
                {r.planCode ?? "Not sure"} · {DEPLOYMENT_LABEL[r.deployment]}
                {r.staffCount && <p className="text-xs text-slate-500">{r.staffCount} staff</p>}
              </td>
              <td className={tdClass}>{dateTime(r.createdAt)}</td>
              <td className={tdClass}>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function Tabs({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "PENDING" } = await searchParams;
  const tabs = [
    ["PENDING", "Waiting"],
    ["APPROVED", "Approved"],
    ["REJECTED", "Rejected"],
    ["", "All"],
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([value, label]) => (
          <Link key={value} href={`/platform/requests?status=${value}`} className={pillClass(status === value)}>
            {label}
          </Link>
        ))}
      </div>
      <Suspense key={status} fallback={<Skeleton className="h-64" />}>
        <List status={status} />
      </Suspense>
    </>
  );
}

export default function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <>
      <PageHeader title="Requests" subtitle="clinics asking to use HMIS" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Tabs searchParams={searchParams} />
      </Suspense>
    </>
  );
}

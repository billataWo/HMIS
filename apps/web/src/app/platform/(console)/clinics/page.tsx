import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, Card, EmptyState, Input, PageHeader, Skeleton } from "@/components/ui";
import { formatAgo } from "@/lib/format";
import { type ClinicRow, DEPLOYMENT_LABEL, platformApi } from "@/lib/platform";
import { date, StateBadge, tdClass, thClass } from "../bits";

async function List({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? "";
  const clinics = await platformApi<ClinicRow[]>(`/platform/clinics${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <>
      <form className="mb-4 flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder="Clinic name" aria-label="Search clinics" />
        <button className={buttonClass}>Search</button>
      </form>
      {clinics.length ? (
        <Card className="overflow-x-auto">
          <table className="-m-5 w-[calc(100%+2.5rem)] text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className={thClass}>Clinic</th>
                <th className={thClass}>Plan</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Until</th>
                <th className={thClass}>Staff</th>
                <th className={thClass}>Patients</th>
                <th className={thClass}>Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {clinics.map((c) => (
                <tr key={c.id}>
                  <td className={tdClass}>
                    <Link href={`/platform/clinics/${c.id}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                      {c.name}
                    </Link>
                    {c.nameAm && <p className="text-xs text-slate-500">{c.nameAm}</p>}
                  </td>
                  <td className={tdClass}>
                    {c.subscription ? (
                      <>
                        {c.subscription.plan.name}
                        <p className="text-xs text-slate-500">{DEPLOYMENT_LABEL[c.subscription.deployment]}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">Not billed</span>
                    )}
                  </td>
                  <td className={tdClass}>{c.subscription && <StateBadge state={c.subscription.state} />}</td>
                  <td className={tdClass}>{c.subscription?.endsAt ? date(c.subscription.endsAt) : c.subscription ? "No end" : ""}</td>
                  <td className={`${tdClass} tabular-nums`}>{c.staff}</td>
                  <td className={`${tdClass} tabular-nums`}>{c.patients}</td>
                  <td className={tdClass}>{c.lastActivityAt ? formatAgo(c.lastActivityAt) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No clinics found" />
      )}
    </>
  );
}

export default function ClinicsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <>
      <PageHeader title="Clinics" subtitle="every clinic on the HMIS cloud" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

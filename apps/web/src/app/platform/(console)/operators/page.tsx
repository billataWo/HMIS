import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { formatAgo } from "@/lib/format";
import { type OperatorMe, type OperatorRow, platformApi } from "@/lib/platform";
import { AddOperatorForm, OperatorActions } from "../../forms";

async function Content() {
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  if (me.role !== "OWNER") return <p className="text-sm text-slate-500">Only owners manage operators.</p>;
  const ops = await platformApi<OperatorRow[]>("/platform/operators");
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
      <Card title="Operators">
        <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
          {ops.map((o) => (
            <li key={o.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span aria-hidden className="grid size-9 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
                  {o.fullName.split(/s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900 dark:text-white">
                    {o.fullName}
                    {o.id === me.id && <span className="font-normal text-slate-500"> (you)</span>}
                  </span>
                  <span className="block truncate text-slate-500">{o.email}</span>
                </span>
                <Badge tone={o.role === "OWNER" ? "violet" : o.role === "BILLING" ? "info" : "neutral"}>{o.role.charAt(0) + o.role.slice(1).toLowerCase()}</Badge>
                {!o.active && <Badge tone="neutral">inactive</Badge>}
                {!o.totpEnabledAt && <Badge tone="warning">two-step not set up</Badge>}
                <span className="ml-auto text-xs text-slate-500">last sign-in {o.lastSignInAt ? formatAgo(o.lastSignInAt) : "never"}</span>
              </div>
              <OperatorActions op={o} self={o.id === me.id} />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Add an operator" description="They set their password and two-step sign-in at the first sign-in.">
        <AddOperatorForm />
      </Card>
    </div>
  );
}

export default function OperatorsPage() {
  return (
    <>
      <PageHeader title="Operators" subtitle="The HMIS team's access to this console: owners do everything, billing handles money, support handles requests." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

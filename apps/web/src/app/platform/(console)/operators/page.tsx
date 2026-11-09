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
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-900 dark:text-white">{o.fullName}</span>
                <span className="text-slate-500">{o.email}</span>
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
      <PageHeader title="Operators" subtitle="the HMIS team's access to this console" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

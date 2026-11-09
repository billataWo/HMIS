import { Suspense } from "react";
import { Card, Notice, PageHeader, Skeleton } from "@/components/ui";
import { type OperatorMe, type Plan, platformApi } from "@/lib/platform";
import { PlanForm } from "../../forms";

async function Content() {
  const [{ plans, features }, me] = await Promise.all([platformApi<{ plans: Plan[]; features: Record<string, string> }>("/platform/plans"), platformApi<OperatorMe>("/platform/auth/me")]);
  const owner = me.role === "OWNER";
  return (
    <div className="space-y-6">
      <Notice tone="info">
        A new price applies from each clinic&apos;s next invoice. Staff limits and modules apply to every clinic on the plan straight away.
        {!owner && " Only owners change plans."}
      </Notice>
      {plans.map((p) => (
        <Card key={p.id} title={`${p.name} (${p.code})`} description={`${p._count?.subscriptions ?? 0} clinics${p.active ? "" : " · not offered to new clinics"}`}>
          {owner ? (
            <PlanForm plan={p} features={features} />
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {Number(p.priceMonthly)} ETB a month · {Number(p.priceYearly)} ETB a year · {p.maxStaff ? `${p.maxStaff} staff` : "no staff limit"} ·{" "}
              {p.features.map((f) => features[f] ?? f).join(", ") || "no extra modules"}
            </p>
          )}
        </Card>
      ))}
      {owner && (
        <Card title="New plan">
          <PlanForm plan={null} features={features} />
        </Card>
      )}
    </div>
  );
}

export default function PlansPage() {
  return (
    <>
      <PageHeader title="Plans" subtitle="prices, staff limits and modules" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

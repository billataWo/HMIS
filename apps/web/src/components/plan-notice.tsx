import Link from "next/link";
import type { ReactNode } from "react";
import { Notice } from "@/components/ui";
import type { Me } from "@/lib/api";

/** Whether the clinic's plan includes a module (null features: every module). */
export const inPlan = (me: Me, feature: string) => !me.features || me.features.includes(feature);

/** Said before someone fills in a form the plan would refuse. */
export function PlanNotice({ me, what, children }: { me: Me; what: string; children?: ReactNode }) {
  return (
    <Notice tone="info">
      <p>
        {what} {what.endsWith("s") ? "are" : "is"} not in {me.subscription?.planName ? `the ${me.subscription.planName} plan` : "this clinic's plan"}.{" "}
        {children}
        {me.role === "ADMIN" ? (
          <>
            {" "}
            <Link href="/settings/subscription" className="font-medium underline">
              See the plans
            </Link>
          </>
        ) : (
          " Ask the clinic's admin about changing the plan."
        )}
      </p>
    </Notice>
  );
}

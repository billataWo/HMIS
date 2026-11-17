"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { Notice } from "@/components/ui";
import type { Me } from "@/lib/api";

/** Said before someone fills in a form the plan would refuse. `what` is the module's English name. */
export function PlanNotice({ me, what, children }: { me: Me; what: string; children?: ReactNode }) {
  const t = useT();
  const plan = me.subscription?.planName;
  return (
    <Notice tone="info">
      <p>
        {plan ? t("{what}: not in the {plan} plan.", { what: t(what), plan }) : t("{what}: not in this clinic's plan.", { what: t(what) })}{" "}
        {children}
        {me.role === "ADMIN" ? (
          <>
            {" "}
            <Link href="/settings/subscription" className="font-medium underline">
              {t("See the plans")}
            </Link>
          </>
        ) : (
          <> {t("Ask the clinic's admin about changing the plan.")}</>
        )}
      </p>
    </Notice>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Notice, PageHeader, Skeleton } from "@/components/ui";
import { type OperatorMe, platformApi } from "@/lib/platform";
import { PasswordForm, TwoStepSetup } from "../../forms";

export const metadata: Metadata = { title: "Your account" };

async function Content() {
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      {(me.mustChangePassword || !me.twoStep.enabled) && (
        <div className="lg:col-span-2">
          <Notice tone="warning">
            Before using the console: {me.mustChangePassword ? "choose your own password, then " : ""}set up two-step sign-in. Operators can see every
            clinic&apos;s subscription and create clinics, so both are required.
          </Notice>
        </div>
      )}
      <Card title="Password">
        <PasswordForm temporary={me.mustChangePassword} />
      </Card>
      {!me.mustChangePassword && (
        <Card
          title="Two-step sign-in"
          description={me.twoStep.enabled ? `On · ${me.twoStep.recoveryCodesLeft} recovery codes left` : "A code from your phone at every sign-in"}
        >
          <TwoStepSetup enabled={me.twoStep.enabled} />
        </Card>
      )}
    </div>
  );
}

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Your account" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

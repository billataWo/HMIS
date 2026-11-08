import { Suspense } from "react";
import { Notice, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDualDate } from "@/lib/format";
import { TwoStepSettings } from "./two-step-settings";

type Status = { enabled: boolean; enabledAt: string | null; required: boolean; recoveryCodesLeft: number };

async function Content({ searchParams }: { searchParams: Promise<{ off?: string }> }) {
  const [status, q] = await Promise.all([api<Status>("/auth/two-step"), searchParams]);
  return (
    <div className="max-w-2xl space-y-4">
      {q.off && <Notice tone="success">Two-step sign-in is off for your account.</Notice>}
      {status.required && !status.enabled && (
        <Notice tone="warning">
          Admins can change prices, refund money and manage staff, so their accounts need two-step sign-in. Set it up to continue: it takes two minutes.
        </Notice>
      )}
      {status.enabled && (
        <Notice tone="success">
          Two-step sign-in is on{status.enabledAt ? ` since ${formatDualDate(status.enabledAt)}` : ""}. {status.recoveryCodesLeft} unused recovery{" "}
          {status.recoveryCodesLeft === 1 ? "code" : "codes"} left.
        </Notice>
      )}
      <TwoStepSettings enabled={status.enabled} required={status.required} recoveryCodesLeft={status.recoveryCodesLeft} />
    </div>
  );
}

export default function TwoStepAccountPage({ searchParams }: { searchParams: Promise<{ off?: string }> }) {
  return (
    <>
      <PageHeader title="Two-step sign-in" subtitle="a code from your phone, as well as your password" />
      <Suspense fallback={<Skeleton className="h-64 max-w-2xl" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

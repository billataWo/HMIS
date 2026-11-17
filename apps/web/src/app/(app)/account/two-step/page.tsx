import { Suspense } from "react";
import { Notice, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDualDate } from "@/lib/format";
import { getT } from "@/lib/lang";
import { TwoStepSettings } from "./two-step-settings";

type Status = { enabled: boolean; enabledAt: string | null; required: boolean; recoveryCodesLeft: number };

async function Content({ searchParams }: { searchParams: Promise<{ off?: string }> }) {
  const [status, q, t] = await Promise.all([api<Status>("/auth/two-step"), searchParams, getT()]);
  return (
    <div className="max-w-2xl space-y-4">
      {q.off && <Notice tone="success">{t("Two-step sign-in is off for your account.")}</Notice>}
      {status.required && !status.enabled && (
        <Notice tone="warning">
          {t("Admins can change prices, refund money and manage staff, so their accounts need two-step sign-in. Set it up to continue: it takes two minutes.")}
        </Notice>
      )}
      {status.enabled && (
        <Notice tone="success">
          {status.enabledAt ? t("Two-step sign-in is on since {date}.", { date: formatDualDate(status.enabledAt) }) : t("Two-step sign-in is on.")}{" "}
          {t(status.recoveryCodesLeft === 1 ? "{n} unused recovery code left." : "{n} unused recovery codes left.", { n: status.recoveryCodesLeft })}
        </Notice>
      )}
      <TwoStepSettings enabled={status.enabled} required={status.required} recoveryCodesLeft={status.recoveryCodesLeft} />
    </div>
  );
}

export default async function TwoStepAccountPage({ searchParams }: { searchParams: Promise<{ off?: string }> }) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t("Two-step sign-in")} subtitle={t("a code from your phone, as well as your password")} />
      <Suspense fallback={<Skeleton className="h-64 max-w-2xl" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

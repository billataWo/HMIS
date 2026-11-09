import { Suspense } from "react";
import { Card, Notice, PageHeader, Skeleton } from "@/components/ui";
import { type OperatorMe, platformApi, type PlatformSettings } from "@/lib/platform";
import { SettingsForm } from "../../forms";

async function Content() {
  const [settings, me] = await Promise.all([platformApi<PlatformSettings>("/platform/settings"), platformApi<OperatorMe>("/platform/auth/me")]);
  return (
    <Card>
      {me.role !== "OWNER" && (
        <div className="mb-4">
          <Notice tone="info">Only owners change these.</Notice>
        </div>
      )}
      <SettingsForm settings={settings} />
      <div className="mt-6 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
        <p className="font-medium text-slate-900 dark:text-white">Online payment</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">
          Chapa: {settings.online?.CHAPA ? "on" : "off"} · telebirr: {settings.online?.TELEBIRR ? "on" : "off"}
          {settings.publicUrl ? ` · payers come back to ${settings.publicUrl}` : " · HMIS_PUBLIC_URL is not set"}
        </p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">Licences for clinic servers: {settings.licences ? "can be issued" : "cannot be issued (HMIS_LICENCE_PRIVATE_KEY is not set)"}</p>
        <p className="mt-1 text-xs text-slate-500">Set on the cloud server in deploy/.env (the keys never go in the database): see docs/saas/README.md.</p>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="trial, grace period, VAT and how clinics pay" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

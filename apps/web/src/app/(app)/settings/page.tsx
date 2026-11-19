import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type ClinicSettings, type Me } from "@/lib/api";
import { getT } from "@/lib/lang";
import { SettingsForm } from "./settings-form";
import { NoAccess } from "@/components/status-page";

async function Settings() {
  const [me, settings, t] = await Promise.all([api<Me>("/auth/me"), api<ClinicSettings>("/settings"), getT()]);
  if (me.role !== "ADMIN") return <NoAccess>{t("Only clinic admins can change settings.")}</NoAccess>;
  return <SettingsForm settings={settings} />;
}

const LINKS: [string, string][] = [
  ["/settings/subscription", "Subscription"],
  ["/settings/data", "Your data"],
  ["/settings/backups", "Backups"],
  ["/settings/sync", "Cloud sync"],
  ["/settings/screens", "Screens"],
  ["/settings/prices", "Prices & lab tests"],
];

async function SettingsLinks() {
  const t = await getT();
  return (
    <>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={secondaryButtonClass}>
          {t(label)}
        </Link>
      ))}
    </>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageTitle title="Settings" subtitle="the clinic's details and how it works" actions={<SettingsLinks />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Settings />
      </Suspense>
    </>
  );
}

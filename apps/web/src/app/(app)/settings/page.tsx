import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type ClinicSettings, type Me } from "@/lib/api";
import { SettingsForm } from "./settings-form";

async function Settings() {
  const [me, settings] = await Promise.all([api<Me>("/auth/me"), api<ClinicSettings>("/settings")]);
  if (me.role !== "ADMIN") return <p className="text-sm text-zinc-500">Only clinic admins can change settings.</p>;
  return <SettingsForm settings={settings} />;
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="ቅንብሮች"
        actions={
          <Link href="/settings/prices" className={secondaryButtonClass}>
            Prices &amp; lab tests
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Settings />
      </Suspense>
    </>
  );
}

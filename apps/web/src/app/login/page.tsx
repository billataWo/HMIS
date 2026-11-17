import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, AuthShell, AuthTitle } from "@/components/auth-shell";
import { OfflineWaiting } from "@/components/offline-waiting";
import { getT } from "@/lib/lang";
import { publicPlans } from "@/lib/public-api";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** On the HMIS cloud only: new clinics ask for HMIS here. */
async function RequestLink() {
  if (!(await publicPlans())) return null;
  const t = await getT();
  return (
    <p className="mt-3 text-sm text-(--l-muted)">
      {t("New clinic?")}{" "}
      <Link href="/welcome" className="font-medium text-(--l-accent) underline-offset-4 hover:underline">
        {t("See plans and request HMIS")}
      </Link>
    </p>
  );
}

export default async function LoginPage() {
  const t = await getT();
  return (
    <AuthShell>
      <AuthTitle title={t("Sign in")}>{t("Use your phone number and password")}</AuthTitle>
      <OfflineWaiting />
      <AuthCard>
        <LoginForm />
      </AuthCard>
      <p className="mt-6 text-sm text-(--l-muted)">{t("Forgot your password? Ask your clinic administrator to reset it.")}</p>
      <Suspense fallback={null}>
        <RequestLink />
      </Suspense>
    </AuthShell>
  );
}

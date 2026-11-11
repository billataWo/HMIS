import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, AuthShell, AuthTitle } from "@/components/auth-shell";
import { OfflineWaiting } from "@/components/offline-waiting";
import { publicPlans } from "@/lib/public-api";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** On the HMIS cloud only: new clinics ask for HMIS here. */
async function RequestLink() {
  if (!(await publicPlans())) return null;
  return (
    <p className="mt-3 text-sm text-(--l-muted)">
      New clinic?{" "}
      <Link href="/welcome" className="font-medium text-(--l-accent) underline-offset-4 hover:underline">
        See plans and request HMIS
      </Link>
    </p>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <AuthTitle title="Sign in">Use your phone number and password · በስልክ ቁጥርዎ ይግቡ</AuthTitle>
      <OfflineWaiting />
      <AuthCard>
        <LoginForm />
      </AuthCard>
      <p className="mt-6 text-sm text-(--l-muted)">Forgot your password? Ask your clinic administrator to reset it.</p>
      <Suspense fallback={null}>
        <RequestLink />
      </Suspense>
    </AuthShell>
  );
}

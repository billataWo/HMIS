import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { AuthCard, AuthShell, AuthTitle } from "@/components/auth-shell";
import { TwoStepForm } from "./two-step-form";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default function TwoStepPage() {
  return (
    <AuthShell>
      <span className="mb-4 grid size-11 place-items-center rounded-xl bg-(--l-accent-soft) text-(--l-accent)">
        <ShieldCheck aria-hidden className="size-6" />
      </span>
      <AuthTitle title="Two-step sign-in">Open your authenticator app and enter the 6-digit code it shows for HMIS.</AuthTitle>
      <AuthCard>
        <TwoStepForm />
      </AuthCard>
      <p className="mt-6 text-sm text-(--l-muted)">Lost your phone? Enter one of your recovery codes instead, or ask another admin to reset your two-step sign-in.</p>
    </AuthShell>
  );
}

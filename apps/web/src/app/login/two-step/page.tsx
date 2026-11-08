import { HeartPulse, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { FadeIn } from "@/components/enter";
import { TwoStepForm } from "./two-step-form";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default function TwoStepPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-8">
      <FadeIn className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-700 text-white">
            <HeartPulse aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">HMIS</span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          <ShieldCheck aria-hidden className="size-6 text-brand-700 dark:text-brand-400" /> Two-step sign-in
        </h1>
        <p className="mt-1 mb-8 text-sm text-slate-500">Open your authenticator app and enter the 6-digit code it shows for HMIS.</p>
        <TwoStepForm />
        <p className="mt-8 text-xs text-slate-400">
          Lost your phone? Enter one of your recovery codes instead, or ask another admin to reset your two-step sign-in.
        </p>
      </FadeIn>
    </main>
  );
}

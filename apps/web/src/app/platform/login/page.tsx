import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "../forms";

export const metadata: Metadata = { title: "HMIS platform" };

/** HMIS staff only: the clinics sign in at /login. */
export default function PlatformLoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <Building2 aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">HMIS platform</p>
            <p className="text-xs text-slate-500">For the HMIS team</p>
          </div>
        </div>
        <LoginForm />
        <p className="mt-8 text-xs text-slate-400">Clinic staff sign in at the clinic&apos;s HMIS address, not here.</p>
      </div>
    </main>
  );
}

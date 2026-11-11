import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "../forms";

export const metadata: Metadata = { title: "HMIS platform" };

/** HMIS staff only: the clinics sign in at /login. */
export default function PlatformLoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-slate-50/60 px-4 py-16 dark:bg-transparent">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">HMIS platform</h1>
            <p className="text-sm text-slate-500">The console for the HMIS team</p>
          </div>
        </div>
        <div className="surface p-6">
          <LoginForm />
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Work at a clinic?{" "}
          <Link href="/login" className="font-medium text-brand-700 underline-offset-4 hover:underline dark:text-brand-400">
            Sign in to your clinic
          </Link>{" "}
          instead.
        </p>
      </div>
    </main>
  );
}

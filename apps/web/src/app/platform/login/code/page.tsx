import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CodeForm } from "../../forms";

export const metadata: Metadata = { title: "HMIS platform" };

export default function PlatformCodePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-white">
          <ShieldCheck aria-hidden className="size-5 text-brand-600" /> Two-step sign-in
        </h1>
        <p className="mb-6 text-sm text-slate-500">Enter the code your authenticator app shows for the HMIS platform.</p>
        <CodeForm />
        <p className="mt-6 text-sm">
          <Link href="/platform/login" className="text-brand-700 hover:underline dark:text-brand-400">
            Back to sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}

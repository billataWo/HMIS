import { HeartPulse, ShieldCheck, Smartphone, Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FadeIn } from "@/components/enter";
import { OfflineWaiting } from "@/components/offline-waiting";
import { publicPlans } from "@/lib/public-api";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const POINTS = [
  { icon: Stethoscope, text: "Queue, consultation, lab, pharmacy and billing in one place" },
  { icon: Smartphone, text: "Telebirr, Chapa and cash, with pay-before-service" },
  { icon: ShieldCheck, text: "Each clinic's records kept private, every change audited" },
];

/** On the HMIS cloud only: new clinics ask for HMIS here. */
async function RequestLink() {
  if (!(await publicPlans())) return null;
  return (
    <p className="mt-3 text-sm text-slate-500">
      New clinic?{" "}
      <Link href="/welcome" className="font-medium text-brand-700 hover:underline dark:text-brand-400">
        See plans and request HMIS
      </Link>
    </p>
  );
}

export default function LoginPage() {
  return (
    <main className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgb(34_211_238/0.25),transparent_45%),radial-gradient(circle_at_90%_90%,rgb(16_185_129/0.2),transparent_40%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <HeartPulse aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">HMIS</span>
        </div>
        <FadeIn className="relative mt-auto max-w-md" delay={0.05}>
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance">Run your clinic&apos;s day, from check-in to receipt.</h2>
          <p className="mt-2 text-brand-100/80">የክሊኒክዎን የዕለት ሥራ በአንድ ቦታ ያስተዳድሩ</p>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-sm text-brand-50/90">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <p.icon aria-hidden className="size-4" />
                </span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </FadeIn>
      </section>

      <section className="flex items-center justify-center px-4 py-16 sm:px-8">
        <FadeIn className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-700 text-white">
              <HeartPulse aria-hidden className="size-5" />
            </span>
            <span className="text-lg font-semibold">HMIS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Sign in</h1>
          <p className="mt-1 mb-8 text-sm text-slate-500">Use your phone number and password · በስልክ ቁጥርዎ ይግቡ</p>
          <OfflineWaiting />
          <LoginForm />
          <p className="mt-8 text-xs text-slate-400">Forgot your password? Ask your clinic administrator to reset it.</p>
          <Suspense fallback={null}>
            <RequestLink />
          </Suspense>
        </FadeIn>
      </section>
    </main>
  );
}

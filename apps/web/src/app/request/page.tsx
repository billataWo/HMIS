import { Check, HeartPulse } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { etb } from "@/lib/format";
import { publicPlans } from "@/lib/public-api";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Use HMIS in your clinic" };

async function Content({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const [offer, { plan }] = await Promise.all([publicPlans(), searchParams]);
  if (!offer) {
    return <p className="text-sm text-slate-500">Requests are made on the HMIS cloud. Ask the HMIS team for its address.</p>;
  }
  return (
    <div className="space-y-10">
      {offer.plans.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Plans</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every plan starts with a {offer.trialDays}-day free trial. Prices are per clinic, plus {Number(offer.vatPercent)}% VAT.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {offer.plans.map((p) => (
              <div key={p.code} className="surface flex flex-col p-5">
                <h3 className="font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
                  {etb(p.priceMonthly)}
                  <span className="text-sm font-normal text-slate-500"> / month</span>
                </p>
                <p className="text-xs text-slate-500">or {etb(p.priceYearly)} a year</p>
                {p.description && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{p.description}</p>}
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                  <li className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    {p.maxStaff ? `Up to ${p.maxStaff} staff accounts` : "Any number of staff"}
                  </li>
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      {offer.features[f] ?? f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Request HMIS</h2>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          We review each request and call you to agree on the details.
          {(offer.supportPhone || offer.supportEmail) && ` Questions: ${[offer.supportPhone, offer.supportEmail].filter(Boolean).join(" · ")}.`}
        </p>
        <RequestForm
          plans={offer.plans.map((p) => ({ code: p.code, name: p.name }))}
          plan={offer.plans.find((p) => p.code === plan)?.code ?? ""}
        />
      </section>
    </div>
  );
}

/** The public page of the HMIS cloud where a clinic asks to use HMIS (reviewed by HMIS). */
export default function RequestPage({ searchParams }: PageProps<"/request">) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-700 text-white">
            <HeartPulse aria-hidden className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">HMIS for your clinic</h1>
            <p className="text-sm text-slate-500">Queue, consultation, lab, pharmacy and billing in one place</p>
          </div>
        </div>
        <div className="flex gap-4 text-sm font-medium">
          <Link href="/welcome" className="text-brand-700 hover:underline dark:text-brand-400">
            About HMIS
          </Link>
          <Link href="/login" className="text-brand-700 hover:underline dark:text-brand-400">
            Already using HMIS? Sign in
          </Link>
        </div>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

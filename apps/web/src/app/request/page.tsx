import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NEXT_STEPS, SiteFrame } from "@/components/site";
import { Skeleton } from "@/components/ui";
import { publicPlans } from "@/lib/public-api";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Use HMIS in your clinic" };

async function Content({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const [offer, { plan }] = await Promise.all([publicPlans(), searchParams]);
  if (!offer) {
    return (
      <p className="rounded-2xl border border-(--l-line) bg-(--l-paper) p-6 text-(--l-muted)">
        Requests are made on the HMIS cloud. Ask the HMIS team for its address, or{" "}
        <Link href="/login" className="font-medium text-(--l-accent) underline-offset-4 hover:underline">
          sign in
        </Link>{" "}
        if your clinic already uses HMIS.
      </p>
    );
  }
  return (
    <RequestForm
      plan={offer.plans.find((p) => p.code === plan)?.code ?? ""}
      offer={{
        plans: offer.plans,
        features: offer.features,
        trialDays: offer.trialDays,
        vatPercent: offer.vatPercent,
        support: [offer.supportPhone, offer.supportEmail].filter(Boolean).join(" · ") || null,
        steps: NEXT_STEPS,
      }}
    />
  );
}

/** The public page of the HMIS cloud where a clinic asks to use HMIS (reviewed by HMIS). */
export default function RequestPage({ searchParams }: PageProps<"/request">) {
  return (
    <SiteFrame cta={false}>
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-20 sm:px-6 lg:pt-16">
        <header className="enter mb-10 max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">Request HMIS</p>
          <h1 className="land-display mt-3 text-5xl leading-[1.02] text-balance text-(--l-ink) sm:text-6xl">Tell us about your clinic</h1>
          <p className="mt-4 max-w-xl leading-relaxed text-pretty text-(--l-muted)">
            Five minutes. We review every request and call you within two working days, then your admin gets a sign-in and the free trial starts.
          </p>
        </header>
        <Suspense fallback={<Skeleton className="h-[40rem]" />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </div>
    </SiteFrame>
  );
}

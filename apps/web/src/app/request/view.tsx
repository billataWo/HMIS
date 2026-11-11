import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { nextSteps, SiteFrame } from "@/components/site";
import { Skeleton } from "@/components/ui";
import type { Lang } from "@/lib/i18n";
import { publicPlans } from "@/lib/public-api";
import { alternates } from "@/lib/site-lang";
import { featureLabels } from "../welcome/copy";
import { REQUEST } from "./copy";
import { RequestForm } from "./request-form";

export function requestMetadata(lang: Lang): Metadata {
  return { title: REQUEST[lang].title, description: REQUEST[lang].description, alternates: alternates("/request", lang) };
}

async function Content({ lang, searchParams }: { lang: Lang; searchParams: Promise<{ plan?: string | string[] }> }) {
  const t = REQUEST[lang];
  const [offer, { plan }] = await Promise.all([publicPlans(), searchParams]);
  if (!offer) {
    return (
      <p className="rounded-2xl border border-(--l-line) bg-(--l-paper) p-6 text-(--l-muted)">
        {t.notCloud[0]}
        <Link href="/login" className="font-medium text-(--l-accent) underline-offset-4 hover:underline">
          {t.notCloud[1]}
        </Link>
        {t.notCloud[2]}
      </p>
    );
  }
  return (
    <RequestForm
      lang={lang}
      plan={offer.plans.find((p) => p.code === plan)?.code ?? ""}
      offer={{
        plans: offer.plans,
        features: featureLabels(lang, offer.features),
        trialDays: offer.trialDays,
        vatPercent: offer.vatPercent,
        support: [offer.supportPhone, offer.supportEmail].filter(Boolean).join(" · ") || null,
        steps: nextSteps(lang),
      }}
    />
  );
}

/** The public page of the HMIS cloud where a clinic asks to use HMIS (reviewed by HMIS), in either language. */
export function RequestView({ lang, searchParams }: { lang: Lang; searchParams: Promise<{ plan?: string | string[] }> }) {
  const t = REQUEST[lang];
  return (
    <SiteFrame cta={false} lang={lang} page="/request">
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-20 sm:px-6 lg:pt-16">
        <header className="enter mb-10 max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">{t.eyebrow}</p>
          <h1 className={`land-display mt-3 text-balance text-(--l-ink) ${lang === "am" ? "text-4xl sm:text-5xl" : "text-5xl leading-[1.02] sm:text-6xl"}`}>{t.h1}</h1>
          <p className="mt-4 max-w-xl leading-relaxed text-pretty text-(--l-muted)">{t.lede}</p>
        </header>
        <Suspense fallback={<Skeleton className="h-[40rem]" />}>
          <Content lang={lang} searchParams={searchParams} />
        </Suspense>
      </div>
    </SiteFrame>
  );
}

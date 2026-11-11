import { ArrowRight, CloudOff, Download, FileSpreadsheet, KeyRound, Languages, Monitor, Phone, ScrollText, Server, ShieldCheck, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FadeIn } from "@/components/enter";
import { FOCUS_ON_DARK, LIGHT_CTA, nextSteps, OUTLINE_CTA, SiteFrame } from "@/components/site";
import { Skeleton } from "@/components/ui";
import type { Lang } from "@/lib/i18n";
import { publicPlans } from "@/lib/public-api";
import { alternates, inLang } from "@/lib/site-lang";
import { Bento } from "./bento";
import { featureLabels, WELCOME } from "./copy";
import { Plans } from "./plans";
import { ProductStage } from "./product-stage";
import { VisitFlow } from "./visit-flow";

export function welcomeMetadata(lang: Lang): Metadata {
  return { title: WELCOME[lang].title, description: WELCOME[lang].description, alternates: alternates("/welcome", lang) };
}

const PROOF_ICONS = [Smartphone, CloudOff, Languages, FileSpreadsheet];
const WAY_ICONS = [Smartphone, Server, CloudOff];
const PRIVACY_ICONS = [ShieldCheck, KeyRound, ScrollText, Download];

async function PlansSection({ lang }: { lang: Lang }) {
  const t = WELCOME[lang].plans;
  const offer = await publicPlans();
  if (!offer || offer.plans.length === 0) {
    return (
      <p className="text-center text-sm text-(--l-muted)">
        {t.ask}{" "}
        <Link href={inLang(lang, "/request")} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
          {t.askLink}
        </Link>
        .
      </p>
    );
  }
  return (
    <>
      <p className="mx-auto -mt-6 mb-8 max-w-xl text-center text-(--l-muted)">{t.intro(offer.trialDays, Number(offer.vatPercent))}</p>
      <Plans plans={offer.plans} features={featureLabels(lang, offer.features)} trialDays={offer.trialDays} lang={lang} />
    </>
  );
}

async function Contact({ lang }: { lang: Lang }) {
  const offer = await publicPlans();
  const ways = [offer?.supportPhone, offer?.supportEmail].filter(Boolean);
  if (!ways.length) return null;
  return (
    <p className="mt-4 flex items-center justify-center gap-2 text-sm text-brand-100/80">
      <Phone aria-hidden className="size-4" />
      {WELCOME[lang].cta.contact} {ways.join(" · ")}
    </p>
  );
}

function Heading({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="land-reveal mx-auto mb-12 max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">{eyebrow}</p>
      <h2 id={id} className="land-display mt-3 scroll-mt-28 text-4xl leading-[1.05] text-balance text-(--l-ink) sm:text-5xl">
        {title}
      </h2>
      {children && <p className="mx-auto mt-4 max-w-xl leading-relaxed text-pretty text-(--l-muted)">{children}</p>}
    </div>
  );
}

/** The HMIS cloud's front page, for clinics that do not use HMIS yet (English at /welcome, Amharic at /am/welcome). */
export function WelcomeView({ lang }: { lang: Lang }) {
  const t = WELCOME[lang];
  const to = (path: string) => inLang(lang, path);
  const steps = nextSteps(lang);
  return (
    <SiteFrame home lang={lang} page="/welcome">
      {/* Hero */}
      <section className="relative overflow-hidden bg-(--l-deep) text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="land-drift absolute -top-1/3 -left-1/4 size-[70vmax] rounded-full bg-[radial-gradient(circle,rgb(34_211_238/0.28),transparent_60%)]" />
          <div className="land-drift-slow absolute -right-1/4 -bottom-1/2 size-[65vmax] rounded-full bg-[radial-gradient(circle,rgb(16_185_129/0.22),transparent_60%)]" />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] bg-size-[32px_32px]" />
        <div className="relative mx-auto grid max-w-6xl gap-14 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-10 lg:pt-24 lg:pb-28">
          <div>
            <FadeIn y={12}>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-50 ring-1 ring-white/15">
                <span aria-hidden className="size-1.5 rounded-full bg-emerald-300" />
                {t.badge}
              </p>
            </FadeIn>
            <FadeIn delay={0.08} y={16}>
              <h1
                className={`land-display mt-6 text-balance ${lang === "am" ? "text-[2.25rem] sm:text-5xl lg:text-[3.25rem]" : "text-[2.75rem] leading-[1.02] tracking-[-0.015em] sm:text-6xl lg:text-[4.25rem]"}`}
              >
                {t.h1[0]}
                <em className="text-brand-200">{t.h1[1]}</em>
                {t.h1[2]}
              </h1>
            </FadeIn>
            <FadeIn delay={0.16} y={12}>
              <p lang={t.sublineLang} className="mt-3 text-lg text-brand-100/80">
                {t.subline}
              </p>
              <p className="mt-6 max-w-xl text-brand-50/90">{t.lede}</p>
            </FadeIn>
            <FadeIn delay={0.24} y={12}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={to("/request")} className={`group ${LIGHT_CTA} ${FOCUS_ON_DARK}`}>
                  {t.start} <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                <a href="#plans" className={`${OUTLINE_CTA} ${FOCUS_ON_DARK}`}>
                  {t.seePlans}
                </a>
              </div>
              <p className="mt-4 text-sm text-brand-100/70">{t.noCard}</p>
            </FadeIn>
          </div>

          <FadeIn delay={0.2} y={24}>
            <ProductStage lang={lang} />
          </FadeIn>
        </div>
      </section>

      {/* Proof: what HMIS really does for an Ethiopian clinic */}
      <section aria-label={t.proofLabel} className="border-b border-(--l-line) bg-(--l-paper)">
        <ul className="land-stagger mx-auto grid max-w-6xl grid-cols-1 gap-x-6 gap-y-5 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {t.proof.map((p, i) => {
            const Icon = PROOF_ICONS[i];
            return (
              <li key={p.title} className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <span className="text-sm">
                  <span className="block font-semibold text-(--l-ink)">{p.title}</span>
                  <span className="block text-(--l-muted)">{p.text}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Modules */}
      <section aria-labelledby="modules" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
        <Heading id="modules" eyebrow={t.modules.eyebrow} title={t.modules.title}>
          {t.modules.text}
        </Heading>
        <Bento lang={lang} />
      </section>

      {/* A visit, step by step */}
      <section aria-labelledby="visit" className="relative overflow-hidden bg-(--l-deep) text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="land-drift-slow absolute -top-1/2 right-0 size-[60vmax] rounded-full bg-[radial-gradient(circle,rgb(34_211_238/0.18),transparent_60%)]" />
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div className="land-reveal">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-200 uppercase">{t.visit.eyebrow}</p>
            <h2 id="visit" className="land-display mt-3 scroll-mt-28 text-4xl leading-[1.05] text-balance sm:text-5xl">
              {t.visit.title}
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-pretty text-brand-50/80">{t.visit.text}</p>
          </div>
          <VisitFlow lang={lang} />
        </div>
      </section>

      {/* Ways to run it */}
      <section aria-labelledby="ways" className="scroll-mt-16 border-y border-(--l-line) bg-(--l-paper) py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Heading id="ways" eyebrow={t.ways.eyebrow} title={t.ways.title}>
            {t.ways.text}
          </Heading>
          <div className="land-stagger grid gap-4 md:grid-cols-3">
            {t.ways.items.map((w, i) => {
              const Icon = WAY_ICONS[i];
              return (
                <div key={w.title} className="surface land-lift p-6">
                  <Icon aria-hidden className="size-6 text-brand-700 dark:text-brand-400" />
                  <h3 className="mt-4 font-semibold text-(--l-ink)">{w.title}</h3>
                  <p className="mt-2 text-sm text-(--l-muted)">{w.text}</p>
                </div>
              );
            })}
          </div>
          <div className="land-reveal mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <Monitor aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-700 dark:text-brand-400" />
            {t.ways.devices}
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section aria-labelledby="privacy" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div className="land-reveal">
            <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">{t.privacy.eyebrow}</p>
            <h2 id="privacy" className="land-display mt-3 scroll-mt-28 text-4xl leading-[1.05] text-balance text-(--l-ink) sm:text-5xl">
              {t.privacy.title}
            </h2>
            <p className="mt-3 text-(--l-muted)">{t.privacy.text}</p>
            <Link href={to("/privacy")} className="mt-4 inline-block text-sm font-medium text-(--l-accent) underline-offset-4 hover:underline">
              {t.privacy.link}
            </Link>
          </div>
          <ul className="land-stagger grid gap-3 sm:grid-cols-2">
            {t.privacy.items.map((text, i) => {
              const Icon = PRIVACY_ICONS[i];
              return (
                <li key={text} className="surface land-lift flex gap-3 p-4 text-sm text-(--l-ink-2)">
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  {text}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Plans */}
      <section aria-labelledby="plans" className="scroll-mt-16 border-y border-(--l-line) bg-(--l-paper) py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Heading id="plans" eyebrow={t.plans.eyebrow} title={t.plans.title} />
          <Suspense fallback={<Skeleton className="h-96" />}>
            <PlansSection lang={lang} />
          </Suspense>
        </div>
      </section>

      {/* How to start */}
      <section aria-labelledby="start" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Heading id="start" eyebrow={t.start_.eyebrow} title={t.start_.title} />
        <div className="relative">
          {/* A line through the step numbers that draws itself as the steps come into view. */}
          <span aria-hidden className="land-draw absolute top-9 right-[12.5%] left-[12.5%] hidden h-0.5 rounded-full bg-linear-to-r from-brand-600 to-emerald-500 lg:block" />
          <ol className="land-stagger relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="surface land-lift p-5">
                <span className="relative grid size-8 place-items-center rounded-full bg-brand-700 text-sm font-semibold text-white tabular-nums ring-4 ring-white dark:ring-slate-950">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-(--l-ink)">{s.title}</h3>
                <p className="mt-1 text-sm text-(--l-muted)">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Questions */}
      <section aria-labelledby="questions" className="scroll-mt-16 border-t border-(--l-line) py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Heading id="questions" eyebrow={t.questions.eyebrow} title={t.questions.title} />
          <div className="land-reveal divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {t.questions.items.map((x) => (
              <details key={x.q} className="land-faq group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-(--l-ink) [&::-webkit-details-marker]:hidden">
                  {x.q}
                  <span
                    aria-hidden
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-lg leading-none text-(--l-muted) transition-[transform,background-color,color] duration-200 group-open:rotate-45 group-open:bg-brand-700 group-open:text-white dark:bg-slate-800"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 text-sm text-(--l-muted)">{x.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="relative overflow-hidden bg-(--l-deep) text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="land-drift absolute -bottom-2/3 left-1/4 size-[60vmax] rounded-full bg-[radial-gradient(circle,rgb(34_211_238/0.3),transparent_60%)]" />
        </div>
        <div className="land-reveal relative mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
          <h2 className="land-display text-4xl leading-[1.05] text-balance sm:text-5xl">{t.cta.title}</h2>
          <p className="mt-3 text-brand-100/80">{t.cta.text}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={to("/request")} className={`${LIGHT_CTA} ${FOCUS_ON_DARK}`}>
              {t.cta.request} <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href="/login" className={`${OUTLINE_CTA} ${FOCUS_ON_DARK}`}>
              {t.cta.signIn}
            </Link>
          </div>
          <Suspense fallback={null}>
            <Contact lang={lang} />
          </Suspense>
        </div>
      </section>
    </SiteFrame>
  );
}

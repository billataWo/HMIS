import {
  ArrowRight,
  CloudOff,
  Download,
  FileSpreadsheet,
  KeyRound,
  Languages,
  Monitor,
  Phone,
  ScrollText,
  Server,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FadeIn } from "@/components/enter";
import { FOCUS_ON_DARK, LIGHT_CTA, NEXT_STEPS, OUTLINE_CTA, SiteFrame } from "@/components/site";
import { Skeleton } from "@/components/ui";
import { publicPlans } from "@/lib/public-api";
import { Plans } from "./plans";
import { Bento } from "./bento";
import { ProductStage } from "./product-stage";
import { VisitFlow } from "./visit-flow";

export const metadata: Metadata = {
  title: "HMIS for Ethiopian clinics",
  description: "Queue, consultation, lab, pharmacy and billing for clinics in Ethiopia. Free trial, then a monthly or yearly plan.",
};



/** Facts only: each one is something HMIS does today. */
const PROOF = [
  { icon: Smartphone, title: "Ethiopian payments", text: "Cash, telebirr and Chapa at the till" },
  { icon: CloudOff, title: "Keeps working offline", text: "On your own server, or for open screens" },
  { icon: Languages, title: "English or Amharic", text: "Each person picks their language" },
  { icon: FileSpreadsheet, title: "MoH report built in", text: "The monthly report as a spreadsheet" },
];


const WAYS = [
  {
    icon: Smartphone,
    title: "On the HMIS cloud",
    text: "Nothing to install. Open HMIS in a browser on any computer or tablet. If the connection drops, the screens you have open keep working and catch up when it is back.",
  },
  {
    icon: Server,
    title: "Your own server, synced",
    text: "A small server at the clinic runs HMIS for everyone on the clinic's network, with or without internet, and keeps a copy in the cloud.",
  },
  {
    icon: CloudOff,
    title: "Your own server only",
    text: "Everything stays at the clinic. Your server checks its HMIS licence; no patient data leaves the building.",
  },
];

const PRIVACY = [
  { icon: ShieldCheck, text: "Each clinic's records are walled off from every other clinic's in the database itself." },
  { icon: KeyRound, text: "Two-step sign-in with a phone app, and staff see only what their role needs." },
  { icon: ScrollText, text: "Every change to a patient's record, and every export, is in the audit log." },
  { icon: Download, text: "Your data is yours: export one patient's record or the whole clinic whenever you want." },
];

const STEPS = NEXT_STEPS;

const QUESTIONS = [
  {
    q: "Do we need internet all the time?",
    a: "On the cloud, HMIS needs internet, but a dropped connection does not stop the screens already open: they keep working and send their changes when it is back. If your connection is unreliable, run HMIS on your own server at the clinic instead.",
  },
  {
    q: "What happens when the free trial ends?",
    a: "You get an invoice for the plan you chose. Until it is paid there is a grace period; after that HMIS becomes read-only. Nothing is deleted, and you can still see and export everything.",
  },
  {
    q: "Can we change plans later?",
    a: "Yes. Tell us when the clinic grows, or when you need fewer staff accounts, and we move you to the plan that fits.",
  },
  {
    q: "Can we leave and take our data?",
    a: "Yes. An admin can download all of the clinic's data at any time, also for a while after the subscription ends, and it can be loaded into another HMIS server.",
  },
  {
    q: "Who can see our patients?",
    a: "Only your clinic's staff, each according to their role. The database itself refuses to show one clinic's records to another, and HMIS's own console shows a clinic's account and invoices, not its patients.",
  },
];

async function PlansSection() {
  const offer = await publicPlans();
  if (!offer || offer.plans.length === 0) {
    return (
      <p className="text-center text-sm text-(--l-muted)">
        Ask us for prices:{" "}
        <Link href="/request" className="font-medium text-brand-700 hover:underline dark:text-brand-400">
          request HMIS
        </Link>
        .
      </p>
    );
  }
  return (
    <>
      <p className="mx-auto -mt-6 mb-8 max-w-xl text-center text-(--l-muted)">
        Every plan starts with a {offer.trialDays}-day free trial. Prices are per clinic, plus {Number(offer.vatPercent)}% VAT.
      </p>
      <Plans plans={offer.plans} features={offer.features} trialDays={offer.trialDays} />
    </>
  );
}

async function Contact() {
  const offer = await publicPlans();
  const ways = [offer?.supportPhone, offer?.supportEmail].filter(Boolean);
  if (!ways.length) return null;
  return (
    <p className="mt-4 flex items-center justify-center gap-2 text-sm text-brand-100/80">
      <Phone aria-hidden className="size-4" />
      Questions first? {ways.join(" · ")}
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

/** The HMIS cloud's front page, for clinics that do not use HMIS yet. */
export default function WelcomePage() {
  return (
    <SiteFrame home>
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
                  Made for clinics in Ethiopia
                </p>
              </FadeIn>
              <FadeIn delay={0.08} y={16}>
                <h1 className="land-display mt-6 text-[2.75rem] leading-[1.02] tracking-[-0.015em] text-balance sm:text-6xl lg:text-[4.25rem]">
                  Run your clinic&apos;s day, from check&#8209;in to <em className="text-brand-200">receipt.</em>
                </h1>
              </FadeIn>
              <FadeIn delay={0.16} y={12}>
                <p className="mt-3 text-lg text-brand-100/80">የክሊኒክዎን የዕለት ሥራ በአንድ ቦታ ያስተዳድሩ</p>
                <p className="mt-6 max-w-xl text-brand-50/90">
                  Queue, consultation, lab, pharmacy and billing in one system your whole team uses. On the cloud or on your own server, and it keeps going when
                  the internet does not.
                </p>
              </FadeIn>
              <FadeIn delay={0.24} y={12}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/request" className={`group ${LIGHT_CTA} ${FOCUS_ON_DARK}`}>
                  Start a free trial <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                <a href="#plans" className={`${OUTLINE_CTA} ${FOCUS_ON_DARK}`}>
                  See plans and prices
                </a>
              </div>
              <p className="mt-4 text-sm text-brand-100/70">No card needed. We call you before anything starts.</p>
              </FadeIn>
            </div>

            <FadeIn delay={0.2} y={24}>
              <ProductStage />
            </FadeIn>
          </div>
        </section>

        {/* Proof: what HMIS really does for an Ethiopian clinic */}
        <section aria-label="Why clinics choose HMIS" className="border-b border-(--l-line) bg-(--l-paper)">
          <ul className="land-stagger mx-auto grid max-w-6xl grid-cols-1 gap-x-6 gap-y-5 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {PROOF.map((p) => (
              <li key={p.title} className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  <p.icon aria-hidden className="size-4.5" />
                </span>
                <span className="text-sm">
                  <span className="block font-semibold text-(--l-ink)">{p.title}</span>
                  <span className="block text-(--l-muted)">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Modules */}
        <section aria-labelledby="modules" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
          <Heading id="modules" eyebrow="What it does" title="Everything a clinic does in a day, in one place">
            Each member of staff signs in with their phone number and sees the screens for their role: reception, nurse, doctor, lab, pharmacy, cashier or admin.
          </Heading>
          <Bento />
        </section>

        {/* A visit, step by step */}
        <section aria-labelledby="visit" className="relative overflow-hidden bg-(--l-deep) text-white">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="land-drift-slow absolute -top-1/2 right-0 size-[60vmax] rounded-full bg-[radial-gradient(circle,rgb(34_211_238/0.18),transparent_60%)]" />
          </div>
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div className="land-reveal">
              <p className="text-xs font-semibold tracking-[0.16em] text-brand-200 uppercase">One system, every step</p>
              <h2 id="visit" className="land-display mt-3 scroll-mt-28 text-4xl leading-[1.05] text-balance sm:text-5xl">
                A patient&apos;s visit, without the paper trail
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-pretty text-brand-50/80">
                Each desk sees the patient arrive on its own screen: the cashier before the doctor if you want payment first, the lab when tests are
                ordered, the pharmacy when a prescription is written. Nobody carries a card between rooms.
              </p>
            </div>
            <VisitFlow />
          </div>
        </section>

        {/* Ways to run it */}
        <section aria-labelledby="ways" className="scroll-mt-16 border-y border-(--l-line) bg-(--l-paper) py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Heading id="ways" eyebrow="How it runs" title="On the cloud, or at your clinic">
              The same HMIS and the same price either way. Choose when you ask for it, and change later if you need to.
            </Heading>
            <div className="land-stagger grid gap-4 md:grid-cols-3">
              {WAYS.map((w) => (
                <div key={w.title} className="surface land-lift p-6">
                  <w.icon aria-hidden className="size-6 text-brand-700 dark:text-brand-400" />
                  <h3 className="mt-4 font-semibold text-(--l-ink)">{w.title}</h3>
                  <p className="mt-2 text-sm text-(--l-muted)">{w.text}</p>
                </div>
              ))}
            </div>
            <div className="land-reveal mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <Monitor aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-700 dark:text-brand-400" />
              Works on the computers and tablets you already have: any up-to-date browser. Receipts and lab reports print on an ordinary printer.
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section aria-labelledby="privacy" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div className="land-reveal">
              <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">Your patients&apos; privacy</p>
              <h2 id="privacy" className="land-display mt-3 scroll-mt-28 text-4xl leading-[1.05] text-balance text-(--l-ink) sm:text-5xl">
                Medical records deserve better than a shared spreadsheet
              </h2>
              <p className="mt-3 text-(--l-muted)">
                HMIS is built for health data: each clinic&apos;s records are separate, each person signs in on their own, and the audit log shows who did what.
              </p>
            </div>
            <ul className="land-stagger grid gap-3 sm:grid-cols-2">
              {PRIVACY.map((p) => (
                <li key={p.text} className="surface land-lift flex gap-3 p-4 text-sm text-(--l-ink-2)">
                  <p.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Plans */}
        <section aria-labelledby="plans" className="scroll-mt-16 border-y border-(--l-line) bg-(--l-paper) py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Heading id="plans" eyebrow="Plans" title="Priced by the size of your clinic" />
            <Suspense fallback={<Skeleton className="h-96" />}>
              <PlansSection />
            </Suspense>
          </div>
        </section>

        {/* How to start */}
        <section aria-labelledby="start" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Heading id="start" eyebrow="Getting started" title="From request to your first patient" />
          <div className="relative">
          {/* A line through the step numbers that draws itself as the steps come into view. */}
          <span aria-hidden className="land-draw absolute top-9 right-[12.5%] left-[12.5%] hidden h-0.5 rounded-full bg-linear-to-r from-brand-600 to-emerald-500 lg:block" />
          <ol className="land-stagger relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
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
            <Heading id="questions" eyebrow="Questions" title="What clinics ask us" />
            <div className="land-reveal divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {QUESTIONS.map((x) => (
                <details key={x.q} className="land-faq group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-(--l-ink) [&::-webkit-details-marker]:hidden">
                    {x.q}
                    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-lg leading-none text-(--l-muted) transition-[transform,background-color,color] duration-200 group-open:rotate-45 group-open:bg-brand-700 group-open:text-white dark:bg-slate-800">+</span>
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
            <h2 className="land-display text-4xl leading-[1.05] text-balance sm:text-5xl">Try HMIS in your clinic</h2>
            <p className="mt-3 text-brand-100/80">Ask today; we call you within two working days.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/request" className={`${LIGHT_CTA} ${FOCUS_ON_DARK}`}>
                Request HMIS <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="/login" className={`${OUTLINE_CTA} ${FOCUS_ON_DARK}`}>
                Already using HMIS? Sign in
              </Link>
            </div>
            <Suspense fallback={null}>
              <Contact />
            </Suspense>
          </div>
        </section>
    </SiteFrame>
  );
}

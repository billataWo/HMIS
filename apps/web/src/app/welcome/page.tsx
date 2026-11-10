import {
  ArrowRight,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  CloudOff,
  Download,
  FlaskConical,
  HeartPulse,
  KeyRound,
  ListOrdered,
  Monitor,
  Phone,
  Pill,
  Receipt,
  ScrollText,
  Server,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  UserPlus,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FadeIn } from "@/components/enter";
import { buttonClass, Skeleton } from "@/components/ui";
import { publicPlans } from "@/lib/public-api";
import { Plans } from "./plans";

export const metadata: Metadata = {
  title: "HMIS for Ethiopian clinics",
  description: "Queue, consultation, lab, pharmacy and billing for clinics in Ethiopia. Free trial, then a monthly or yearly plan.",
};

/** A patient's visit, as the clinic's staff see it in HMIS. */
const DAY = [
  { icon: UserPlus, title: "Check-in", text: "Register or find the patient; they get a queue number" },
  { icon: Receipt, title: "Pay first", text: "Cash, telebirr or Chapa before each service, if you want it" },
  { icon: Stethoscope, title: "Consultation", text: "Vitals, notes, ICD-11 diagnoses and orders" },
  { icon: FlaskConical, title: "Lab", text: "Orders arrive at the bench; results go back to the doctor" },
  { icon: Pill, title: "Pharmacy", text: "Prescriptions dispensed from stock, by batch and expiry" },
  { icon: ClipboardCheck, title: "Done", text: "Receipt printed, visit closed, follow-up booked" },
];

const MODULES = [
  { icon: ListOrdered, title: "Queue and waiting room", text: "Live queue for each department, and a TV screen that calls the next number." },
  { icon: CalendarDays, title: "Appointments", text: "Book visits ahead and see who is coming each day." },
  { icon: Stethoscope, title: "Consultation records", text: "History, allergies, vitals, notes, ICD-11 diagnoses and prescriptions per visit." },
  { icon: FlaskConical, title: "Laboratory", text: "Test orders, result entry with reference ranges, and printable lab reports." },
  { icon: Pill, title: "Pharmacy and stock", text: "Dispensing, stock by batch, expiry warnings, and purchase orders where the plan includes them." },
  { icon: Receipt, title: "Billing", text: "Price list, invoices and receipts. Credit and insurance accounts where the plan includes them." },
  { icon: ChartColumn, title: "Reports", text: "Daily takings, visits and the monthly MoH report as a spreadsheet." },
  { icon: ScrollText, title: "Audit log", text: "Who changed what, and when, for every record." },
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

const STEPS = [
  { title: "Ask for HMIS", text: "Five minutes on the request page: the clinic, a contact and a plan." },
  { title: "We call you", text: "Within two working days, to check the details and answer questions." },
  { title: "Free trial", text: "Your admin signs in, adds the staff, and starts with a ready-made price list." },
  { title: "Pay to continue", text: "When the trial ends, pay by telebirr, Chapa or bank transfer." },
];

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
      <p className="text-center text-sm text-slate-500">
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
      <p className="mx-auto -mt-6 mb-8 max-w-xl text-center text-slate-600 dark:text-slate-300">
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
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-3xl font-semibold tracking-tight text-balance text-slate-900 dark:text-white">
        {title}
      </h2>
      {children && <p className="mt-3 text-slate-600 dark:text-slate-300">{children}</p>}
    </div>
  );
}

/** The HMIS cloud's front page, for clinics that do not use HMIS yet. */
export default function WelcomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/welcome" className="flex items-center gap-2.5 font-semibold text-slate-900 dark:text-white">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-700 text-white">
              <HeartPulse aria-hidden className="size-4" />
            </span>
            HMIS
          </Link>
          <div className="hidden items-center gap-6 text-sm text-slate-600 md:flex dark:text-slate-300">
            <a href="#modules" className="hover:text-slate-900 dark:hover:text-white">What it does</a>
            <a href="#ways" className="hover:text-slate-900 dark:hover:text-white">How it runs</a>
            <a href="#plans" className="hover:text-slate-900 dark:hover:text-white">Plans</a>
            <a href="#questions" className="hover:text-slate-900 dark:hover:text-white">Questions</a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
              Sign in
            </Link>
            <Link href="/request" className={`${buttonClass} hidden sm:inline-flex`}>
              Request HMIS
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-brand-900 text-white">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgb(34_211_238/0.25),transparent_45%),radial-gradient(circle_at_95%_100%,rgb(16_185_129/0.2),transparent_40%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px]" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-24">
            <FadeIn>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-50 ring-1 ring-white/15">
                Made for clinics in Ethiopia
              </p>
              <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">Run your clinic&apos;s day, from check&#8209;in to receipt.</h1>
              <p className="mt-3 text-lg text-brand-100/80">የክሊኒክዎን የዕለት ሥራ በአንድ ቦታ ያስተዳድሩ</p>
              <p className="mt-6 max-w-xl text-brand-50/90">
                Queue, consultation, lab, pharmacy and billing in one system your whole team uses. On the cloud or on your own server, and it keeps going when
                the internet does not.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/request" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-50">
                  Start a free trial <ArrowRight aria-hidden className="size-4" />
                </Link>
                <a href="#plans" className="inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
                  See plans and prices
                </a>
              </div>
            </FadeIn>

            <FadeIn delay={0.08}>
              <ol aria-label="A patient's visit in HMIS" className="relative rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/15 backdrop-blur-sm sm:p-6">
                {DAY.map((s, i) => (
                  <li key={s.title} className="relative flex gap-4 pb-5 last:pb-0">
                    {i < DAY.length - 1 && <span aria-hidden className="absolute top-10 bottom-0 left-[1.1875rem] w-px bg-white/20" />}
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
                      <s.icon aria-hidden className="size-[1.125rem]" />
                    </span>
                    <div className="pt-0.5">
                      <p className="font-medium">{s.title}</p>
                      <p className="text-sm text-brand-100/75">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </FadeIn>
          </div>
        </section>

        {/* Modules */}
        <section aria-labelledby="modules" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
          <Heading id="modules" eyebrow="What it does" title="Everything a clinic does in a day, in one place">
            Each member of staff signs in with their phone number and sees the screens for their role: reception, nurse, doctor, lab, pharmacy, cashier or admin.
          </Heading>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m) => (
              <div key={m.title} className="surface p-5">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  <m.icon aria-hidden className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{m.title}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{m.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Ways to run it */}
        <section aria-labelledby="ways" className="scroll-mt-16 border-y border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Heading id="ways" eyebrow="How it runs" title="On the cloud, or at your clinic">
              The same HMIS and the same price either way. Choose when you ask for it, and change later if you need to.
            </Heading>
            <div className="grid gap-4 md:grid-cols-3">
              {WAYS.map((w) => (
                <div key={w.title} className="surface p-6">
                  <w.icon aria-hidden className="size-6 text-brand-700 dark:text-brand-400" />
                  <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{w.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{w.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <Monitor aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-700 dark:text-brand-400" />
              Works on the computers and tablets you already have: any up-to-date browser. Receipts and lab reports print on an ordinary printer.
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section aria-labelledby="privacy" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">Your patients&apos; privacy</p>
              <h2 id="privacy" className="mt-2 text-3xl font-semibold tracking-tight text-balance text-slate-900 dark:text-white">
                Medical records deserve better than a shared spreadsheet
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300">
                HMIS is built for health data: each clinic&apos;s records are separate, each person signs in on their own, and the audit log shows who did what.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {PRIVACY.map((p) => (
                <li key={p.text} className="surface flex gap-3 p-4 text-sm text-slate-700 dark:text-slate-200">
                  <p.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Plans */}
        <section aria-labelledby="plans" className="scroll-mt-16 border-y border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40">
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
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="surface p-5">
                <span className="grid size-8 place-items-center rounded-full bg-brand-700 text-sm font-semibold text-white tabular-nums">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Questions */}
        <section aria-labelledby="questions" className="scroll-mt-16 border-t border-slate-200 py-20 dark:border-slate-800">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <Heading id="questions" eyebrow="Questions" title="What clinics ask us" />
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {QUESTIONS.map((x) => (
                <details key={x.q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-slate-900 dark:text-white [&::-webkit-details-marker]:hidden">
                    {x.q}
                    <span aria-hidden className="text-xl leading-none text-slate-400 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{x.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Call to action */}
        <section className="relative overflow-hidden bg-brand-900 text-white">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgb(34_211_238/0.25),transparent_55%)]" />
          <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">Try HMIS in your clinic</h2>
            <p className="mt-3 text-brand-100/80">Ask today; we call you within two working days.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/request" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-50">
                Request HMIS <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="/login" className="inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
                Already using HMIS? Sign in
              </Link>
            </div>
            <Suspense fallback={null}>
              <Contact />
            </Suspense>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-800">
        HMIS · Clinic management for Ethiopia
      </footer>
    </div>
  );
}

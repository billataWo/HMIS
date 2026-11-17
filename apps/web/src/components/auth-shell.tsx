import { HeartPulse, ShieldCheck, Smartphone, Stethoscope } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { FadeIn } from "@/components/enter";
import { LangSwitch } from "@/components/lang-switch";
import { display } from "@/components/site";
import { getT } from "@/lib/lang";

const POINTS = [
  { icon: Stethoscope, text: "Queue, consultation, lab, pharmacy and billing in one place" },
  { icon: Smartphone, text: "Telebirr, Chapa and cash, with pay-before-service" },
  { icon: ShieldCheck, text: "Each clinic's records kept private, every change audited" },
];

/**
 * The sign-in screens (password, then the two-step code), in the public site's look: the brand
 * panel on wide screens, the form on its own card. Staff see this every day, so it stays quiet:
 * one entrance, no moving parts.
 */
export async function AuthShell({ children, here = "/login" }: { children: ReactNode; here?: string }) {
  const t = await getT();
  const am = t.lang === "am";
  return (
    <main className={`land ${display.variable} grid flex-1 bg-(--l-canvas) lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]`}>
      <section className="relative hidden overflow-hidden bg-(--l-deep) p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="land-drift absolute -top-1/3 -left-1/3 size-[60vmax] rounded-full bg-[radial-gradient(circle,rgb(34_211_238/0.22),transparent_60%)]" />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] bg-size-[32px_32px] opacity-[0.06]" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <HeartPulse aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">HMIS</span>
        </div>
        <FadeIn className="relative mt-auto max-w-md" delay={0.05}>
          {am ? (
            <p lang="am" className="land-display text-5xl leading-[1.15] text-balance">
              የክሊኒክዎን ዕለታዊ ሥራ ከመቀበያ እስከ <em className="text-brand-200">ደረሰኝ</em> ያስተዳድሩ።
            </p>
          ) : (
            <p className="land-display text-5xl leading-[1.02] text-balance">
              {/* i18n-ignore: the English headline (the Amharic one is above) */}
              Run your clinic&apos;s day, from check&#8209;in to <em className="text-brand-200">receipt.</em>
            </p>
          )}
          <p lang={am ? "en" : "am"} className="mt-3 text-brand-100/80">
            {/* i18n-ignore: the line in the other language */}
            {am ? "Run your clinic's day, all in one place" : "የክሊኒክዎን የዕለት ሥራ በአንድ ቦታ ያስተዳድሩ"}
          </p>
          <ul className="mt-10 space-y-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-sm text-brand-50/90">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <p.icon aria-hidden className="size-4" />
                </span>
                <span className="pt-1.5">{t(p.text)}</span>
              </li>
            ))}
          </ul>
        </FadeIn>
      </section>

      <section className="flex items-center justify-center px-4 py-14 sm:px-8">
        <FadeIn className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-700 text-white lg:hidden">
              <HeartPulse aria-hidden className="size-5" />
            </span>
            <span className="text-lg font-semibold text-(--l-ink) lg:hidden">HMIS</span>
            <LangSwitch lang={t.lang} en={here} am={here} className="ml-auto" />
          </div>
          {children}
          <p className="mt-8 text-center text-xs text-(--l-muted)">
            <Link href="/privacy" className="rounded underline-offset-4 hover:text-(--l-ink) hover:underline">
              {t("Privacy policy")}
            </Link>
            <span aria-hidden> · </span>
            <Link href="/terms" className="rounded underline-offset-4 hover:text-(--l-ink) hover:underline">
              {t("Terms of service")}
            </Link>
          </p>
        </FadeIn>
      </section>
    </main>
  );
}

/** The heading and lede of a sign-in step. */
export function AuthTitle({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <>
      <h1 className="land-display text-4xl leading-tight text-(--l-ink)">{title}</h1>
      {children && <p className="mt-2 mb-7 text-sm text-(--l-muted)">{children}</p>}
    </>
  );
}

/** The form's card. */
export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-(--l-line) bg-(--l-paper) p-6 shadow-(--l-shadow)">{children}</div>;
}

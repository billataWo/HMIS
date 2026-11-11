import { HeartPulse } from "lucide-react";
import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import type { Lang } from "@/lib/i18n";
import { inLang, type PUBLIC_PAGES } from "@/lib/site-lang";
import { LangSwitch } from "./lang-switch";

/*
 * The public site's frame (front page, request, sign-in): the page tokens (`.land`, globals.css),
 * the display face, the header and the footer. One place, so every public page looks like the
 * same product, in English and in Amharic.
 */

/** Headlines: a serif display face, set large and tight; everything else reads in Inter. */
export const display = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-display", display: "swap" });

/** Keyboard focus that is always visible, on light and on the dark brand sections. */
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
export const FOCUS_ON_DARK = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
export const LIGHT_CTA = "inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-brand-900 shadow-sm transition-colors hover:bg-brand-50";
export const OUTLINE_CTA = "inline-flex min-h-11 items-center rounded-lg px-5 text-sm font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/10";

const FRAME = {
  en: {
    sections: [
      ["modules", "What it does"],
      ["ways", "How it runs"],
      ["plans", "Plans"],
      ["questions", "Questions"],
    ],
    skip: "Skip to content",
    main: "Main",
    signIn: "Sign in",
    request: "Request HMIS",
    requestShort: "Request",
    tagline: "Clinic management for Ethiopia: queue, consultation, lab, pharmacy and billing.",
    footer: "Footer",
    links: { plans: "Plans and prices", request: "Request HMIS", questions: "Questions", signIn: "Sign in", privacy: "Privacy policy", terms: "Terms of service" },
  },
  am: {
    sections: [
      ["modules", "ምን ይሰራል"],
      ["ways", "እንዴት ይሰራል"],
      ["plans", "ዕቅዶች"],
      ["questions", "ጥያቄዎች"],
    ],
    skip: "ወደ ይዘቱ ይዝለሉ",
    main: "ዋና",
    signIn: "ይግቡ",
    request: "HMIS ይጠይቁ",
    requestShort: "ይጠይቁ",
    tagline: "ለኢትዮጵያ ክሊኒኮች የተሰራ የክሊኒክ አስተዳደር፦ ወረፋ፣ ምርመራ፣ ላብራቶሪ፣ ፋርማሲና ክፍያ።",
    footer: "ግርጌ",
    links: { plans: "ዕቅዶችና ዋጋዎች", request: "HMIS ይጠይቁ", questions: "ጥያቄዎች", signIn: "ይግቡ", privacy: "የግላዊነት ፖሊሲ", terms: "የአገልግሎት ውል" },
  },
} as const;

function Mark({ small }: { small?: boolean }) {
  return (
    <span className={`grid place-items-center bg-brand-700 text-white ${small ? "size-7 rounded-md" : "size-8 rounded-lg"}`}>
      <HeartPulse aria-hidden className={small ? "size-3.5" : "size-4"} />
    </span>
  );
}

/**
 * A public page in the site's frame. `home`: the front page itself (its section links stay on the
 * page); elsewhere they lead back to it. `cta`: hide the header's "Request HMIS" (on the request
 * page itself). `page`: which public page this is, for the language switch.
 */
export function SiteFrame({
  children,
  home = false,
  cta = true,
  className = "",
  lang = "en",
  page = "/welcome",
}: {
  children: ReactNode;
  home?: boolean;
  cta?: boolean;
  className?: string;
  lang?: Lang;
  page?: (typeof PUBLIC_PAGES)[number];
}) {
  const t = FRAME[lang];
  const to = (path: string) => inLang(lang, path);
  const section = (id: string) => (home ? `#${id}` : to(`/welcome#${id}`));
  const navLink = `rounded-lg px-3 py-2 hover:bg-black/5 hover:text-(--l-ink) dark:hover:bg-white/10 ${FOCUS}`;
  return (
    <div lang={lang} className={`land ${display.variable} flex flex-1 flex-col bg-(--l-canvas) scroll-smooth motion-reduce:scroll-auto ${className}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900 focus:shadow"
      >
        {t.skip}
      </a>
      <header className="land-header sticky top-0 z-20 border-b border-(--l-line) bg-(--l-paper)/85 backdrop-blur">
        <nav aria-label={t.main} className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:gap-6">
          <Link href={to("/welcome")} className={`flex items-center gap-2.5 rounded-lg font-semibold text-(--l-ink) ${FOCUS}`}>
            <Mark />
            HMIS
          </Link>
          <div className="hidden items-center gap-1 text-sm text-(--l-muted) lg:flex">
            {t.sections.map(([id, label]) => (
              <a key={id} href={section(id)} className={navLink}>
                {label}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LangSwitch lang={lang} en={inLang("en", page)} am={inLang("am", page)} className="hidden sm:flex" />
            <Link href="/login" className={`flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-(--l-ink-2) hover:bg-black/5 dark:hover:bg-white/10 ${FOCUS}`}>
              {t.signIn}
            </Link>
            {cta && (
              <Link href={to("/request")} className={buttonClass}>
                <span className="sm:hidden">{t.requestShort}</span>
                <span className="hidden sm:inline">{t.request}</span>
              </Link>
            )}
          </div>
        </nav>
        {/* Phones: the language switch gets its own thin row, so the header never crowds. */}
        <div className="flex justify-end border-t border-(--l-line) px-4 py-1.5 sm:hidden">
          <LangSwitch lang={lang} en={inLang("en", page)} am={inLang("am", page)} />
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-(--l-line) bg-(--l-paper)">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="flex items-center gap-2 font-semibold text-(--l-ink)">
              <Mark small />
              HMIS
            </p>
            <p className="mt-2 max-w-xs text-sm text-(--l-muted)">{t.tagline}</p>
          </div>
          <nav aria-label={t.footer} className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
            {[
              [section("plans"), t.links.plans],
              [to("/request"), t.links.request],
              [section("questions"), t.links.questions],
              ["/login", t.links.signIn],
              [to("/privacy"), t.links.privacy],
              [to("/terms"), t.links.terms],
            ].map(([href, label]) => (
              <Link key={label} href={href} className={`rounded text-(--l-muted) hover:text-(--l-ink) ${FOCUS}`}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** The step list of what happens after a request (front page and request page). */
export function nextSteps(lang: Lang) {
  return lang === "am"
    ? [
        { title: "HMIS ይጠይቁ", text: "በጥያቄ ገጹ ላይ አምስት ደቂቃ፦ ስለ ክሊኒኩ፣ የሚገናኙትን ሰው እና ዕቅድ ይሙሉ።" },
        { title: "እኛ እንደውልልዎታለን", text: "በሁለት የሥራ ቀናት ውስጥ ዝርዝሩን ለማረጋገጥና ጥያቄዎችዎን ለመመለስ።" },
        { title: "ነፃ ሙከራ", text: "አስተዳዳሪዎ ገብቶ ሰራተኞችን ይጨምራል፣ በተዘጋጀ የዋጋ ዝርዝር ይጀምራል።" },
        { title: "ለመቀጠል ይክፈሉ", text: "ሙከራው ሲያልቅ በቴሌብር፣ በቻፓ ወይም በባንክ ዝውውር ይክፈሉ።" },
      ]
    : [
        { title: "Ask for HMIS", text: "Five minutes on the request page: the clinic, a contact and a plan." },
        { title: "We call you", text: "Within two working days, to check the details and answer questions." },
        { title: "Free trial", text: "Your admin signs in, adds the staff, and starts with a ready-made price list." },
        { title: "Pay to continue", text: "When the trial ends, pay by telebirr, Chapa or bank transfer." },
      ];
}

/** @deprecated The English steps; use nextSteps(lang). */
export const NEXT_STEPS = nextSteps("en");

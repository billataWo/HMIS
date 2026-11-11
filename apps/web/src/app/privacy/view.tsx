import type { Metadata } from "next";
import { Suspense } from "react";
import { LegalDoc, legalFacts } from "@/components/legal";
import { SiteFrame } from "@/components/site";
import { Skeleton } from "@/components/ui";
import type { Lang } from "@/lib/i18n";
import { alternates, inLang } from "@/lib/site-lang";
import { privacySectionsAm, privacySummaryAm } from "./am";
import { privacySectionsEn, privacySummaryEn } from "./en";

const COPY = {
  en: { title: "Privacy Policy", description: "How HMIS collects, uses, stores and protects personal data, including the patient records clinics keep in it.", other: "Terms of Service" },
  am: { title: "የግላዊነት ፖሊሲ", description: "HMIS የግል መረጃን — ክሊኒኮች የሚይዙትን የታካሚ መዝገብ ጨምሮ — እንዴት እንደሚሰበስብ፣ እንደሚጠቀምበት፣ እንደሚያስቀምጥና እንደሚጠብቅ።", other: "የአገልግሎት ውል" },
} satisfies Record<Lang, unknown>;

export function privacyMetadata(lang: Lang): Metadata {
  return { title: COPY[lang].title, description: COPY[lang].description, alternates: alternates("/privacy", lang) };
}

async function Content({ lang }: { lang: Lang }) {
  const facts = await legalFacts();
  return (
    <LegalDoc
      lang={lang}
      title={COPY[lang].title}
      other={{ href: inLang(lang, "/terms"), label: COPY[lang].other }}
      summary={lang === "am" ? privacySummaryAm(facts) : privacySummaryEn(facts)}
      sections={lang === "am" ? privacySectionsAm(facts) : privacySectionsEn(facts)}
    />
  );
}

/** The Privacy Policy (public), in English or Amharic. If the two differ, the English applies. */
export function PrivacyView({ lang }: { lang: Lang }) {
  return (
    <SiteFrame lang={lang} page="/privacy">
      <Suspense
        fallback={
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <Skeleton className="h-96" />
          </div>
        }
      >
        <Content lang={lang} />
      </Suspense>
    </SiteFrame>
  );
}

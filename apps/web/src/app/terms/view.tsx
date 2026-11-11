import type { Metadata } from "next";
import { Suspense } from "react";
import { LegalDoc, legalFacts } from "@/components/legal";
import { SiteFrame } from "@/components/site";
import { Skeleton } from "@/components/ui";
import type { Lang } from "@/lib/i18n";
import { alternates, inLang } from "@/lib/site-lang";
import { termsSectionsAm, termsSummaryAm } from "./am";
import { termsSectionsEn, termsSummaryEn } from "./en";

const COPY = {
  en: { title: "Terms of Service", description: "The agreement between HMIS and the clinics that use it: subscriptions, payment, patient data, and what each side is responsible for.", other: "Privacy Policy" },
  am: { title: "የአገልግሎት ውል", description: "በHMIS እና በሚጠቀሙት ክሊኒኮች መካከል ያለው ስምምነት፦ የደንበኝነት ምዝገባ፣ ክፍያ፣ የታካሚ መረጃ እና የእያንዳንዱ ወገን ኃላፊነት።", other: "የግላዊነት ፖሊሲ" },
} satisfies Record<Lang, unknown>;

export function termsMetadata(lang: Lang): Metadata {
  return { title: COPY[lang].title, description: COPY[lang].description, alternates: alternates("/terms", lang) };
}

async function Content({ lang }: { lang: Lang }) {
  const facts = await legalFacts();
  return (
    <LegalDoc
      lang={lang}
      title={COPY[lang].title}
      other={{ href: inLang(lang, "/privacy"), label: COPY[lang].other }}
      summary={lang === "am" ? termsSummaryAm() : termsSummaryEn()}
      sections={lang === "am" ? termsSectionsAm(facts) : termsSectionsEn(facts)}
    />
  );
}

/** The Terms of Service (public), in English or Amharic. If the two differ, the English applies. */
export function TermsView({ lang }: { lang: Lang }) {
  return (
    <SiteFrame lang={lang} page="/terms">
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

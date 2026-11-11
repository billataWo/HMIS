import Link from "next/link";
import type { ReactNode } from "react";
import { formatEthiopian } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { LEGAL, providerName } from "@/lib/legal";
import { publicPlans } from "@/lib/public-api";
import { FOCUS } from "./site";

/** The numbers and contacts the documents quote, from the platform's settings where it has them. */
export type LegalFacts = {
  trialDays: number | null;
  graceDays: number | null;
  vatPercent: number | null;
  retentionDays: number;
  email: string | null;
  phone: string | null;
};

export async function legalFacts(): Promise<LegalFacts> {
  const offer = await publicPlans();
  return {
    trialDays: offer?.trialDays ?? null,
    graceDays: offer?.graceDays ?? null,
    vatPercent: offer ? Number(offer.vatPercent) : null,
    retentionDays: offer?.dataRetentionDays ?? 60,
    email: LEGAL.email || offer?.supportEmail || null,
    phone: LEGAL.phone || offer?.supportPhone || null,
  };
}

export type LegalSection = { id: string; title: string; body: ReactNode };

/** The frame's own words. */
const UI = {
  en: {
    updated: `Last updated ${LEGAL.updated}`,
    version: "version",
    contents: "Contents",
    translation: null as string | null,
    email: "Email",
    phone: "Phone",
    trade: "Commercial registration",
    eca: "Registered with the Ethiopian Communications Authority",
    noContact: "Contact the HMIS team through your clinic's account, or the request page.",
  },
  am: {
    // The date in the Ethiopian calendar first, then the Gregorian one the version is named by.
    updated: `መጨረሻ የተሻሻለው ${formatEthiopian(new Date(`${LEGAL.version}T12:00:00+03:00`))} ዓ.ም. (${LEGAL.updated})`,
    version: "ስሪት",
    contents: "ማውጫ",
    translation: "ይህ የእንግሊዝኛው ሰነድ ትርጉም ነው፤ ሁለቱ ቢለያዩ የእንግሊዝኛው ቅጂ ተፈጻሚ ይሆናል።" as string | null,
    email: "ኢሜይል",
    phone: "ስልክ",
    trade: "የንግድ ምዝገባ ቁጥር",
    eca: "በኢትዮጵያ ኮሙኒኬሽን ባለሥልጣን የተመዘገበበት ቁጥር",
    noContact: "የHMIS ቡድንን በክሊኒክዎ መለያ ወይም በጥያቄ ገጹ በኩል ያግኙ።",
  },
} satisfies Record<Lang, unknown>;

/**
 * A legal document: the title and date, a list of contents (beside the text on wide screens),
 * then numbered sections, each with its own link.
 */
export function LegalDoc({
  title,
  summary,
  sections,
  other,
  lang = "en",
}: {
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
  other: { href: string; label: string };
  lang?: Lang;
}) {
  const ui = UI[lang];
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">{providerName}</p>
        <h1 className={`land-display mt-3 text-(--l-ink) ${lang === "am" ? "text-4xl sm:text-5xl" : "text-5xl leading-[1.05] sm:text-6xl"}`}>{title}</h1>
        <p className="mt-4 text-sm text-(--l-muted)">
          {ui.updated} · {ui.version} {LEGAL.version} ·{" "}
          <Link href={other.href} className={`rounded font-medium text-(--l-accent) underline-offset-4 hover:underline ${FOCUS}`}>
            {other.label}
          </Link>
        </p>
        {ui.translation && <p className="mt-2 text-sm text-(--l-muted)">{ui.translation}</p>}
        <div className="mt-6 rounded-2xl border border-(--l-line) bg-(--l-accent-soft) p-5 text-[15px] leading-relaxed text-(--l-ink-2)">{summary}</div>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label={ui.contents} className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-semibold tracking-[0.16em] text-(--l-muted) uppercase">{ui.contents}</p>
          <ol className="mt-3 space-y-1 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={`flex gap-2 rounded-md px-2 py-1 text-(--l-ink-2) hover:bg-black/5 hover:text-(--l-ink) dark:hover:bg-white/10 ${FOCUS}`}>
                  <span className="w-5 shrink-0 text-(--l-muted) tabular-nums">{i + 1}.</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="legal max-w-3xl">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24 border-t border-(--l-line) py-8 first:border-t-0 first:pt-0">
              <h2 id={`${s.id}-title`} className="text-xl font-semibold tracking-tight text-(--l-ink)">
                <span className="mr-2 text-(--l-muted) tabular-nums">{i + 1}.</span>
                {s.title}
              </h2>
              <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-(--l-ink-2)">{s.body}</div>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

/** A list with the site's bullets. */
export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-(--l-accent)">{children}</ul>;
}

/** A small table that scrolls sideways on a phone instead of squeezing. */
export function LegalTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-(--l-line)">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="bg-(--l-canvas) text-(--l-ink)">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-(--l-line)">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? "font-medium text-(--l-ink)" : "text-(--l-ink-2)"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The provider's identity and contact, as each document's last section shows it. */
export function ContactBlock({ facts, lang = "en" }: { facts: LegalFacts; lang?: Lang }) {
  const ui = UI[lang];
  const lines = [
    LEGAL.provider,
    LEGAL.address,
    LEGAL.tradeRegistration && `${ui.trade}: ${LEGAL.tradeRegistration}`,
    LEGAL.dataProtectionRegistration && `${ui.eca}: ${LEGAL.dataProtectionRegistration}`,
  ].filter(Boolean);
  return (
    <div className="rounded-xl border border-(--l-line) bg-(--l-paper) p-5">
      {lines.length > 0 && (
        <address className="not-italic">
          {lines.map((l) => (
            <span key={l as string} className="block">
              {l}
            </span>
          ))}
        </address>
      )}
      <p className={lines.length ? "mt-3" : ""}>
        {facts.email && (
          <>
            {ui.email}:{" "}
            <a href={`mailto:${facts.email}`} className={`rounded font-medium text-(--l-accent) underline-offset-4 hover:underline ${FOCUS}`}>
              {facts.email}
            </a>
          </>
        )}
        {facts.email && facts.phone && " · "}
        {facts.phone && (
          <>
            {ui.phone}:{" "}
            <a href={`tel:${facts.phone.replace(/\s/g, "")}`} className={`rounded font-medium text-(--l-accent) underline-offset-4 hover:underline ${FOCUS}`}>
              {facts.phone}
            </a>
          </>
        )}
        {!facts.email && !facts.phone && ui.noContact}
      </p>
    </div>
  );
}

export const docLink = `rounded font-medium text-(--l-accent) underline-offset-4 hover:underline ${FOCUS}`;

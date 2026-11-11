"use client";

import type { Lang } from "@/lib/i18n";

/** lib/i18n.ts LANG_COOKIE, written here so the app's dictionary stays out of the public pages' scripts. */
const LANG_COOKIE = "hmis_lang";

function remember(l: Lang) {
  document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
}

/**
 * English | አማርኛ, for the public site. Goes to the same page in the other language and remembers
 * the choice (the sign-in and the app use it too).
 */
export function LangSwitch({ lang, en, am, className = "" }: { lang: Lang; en: string; am: string; className?: string }) {
  const item = (l: Lang, href: string, label: string) =>
    l === lang ? (
      <span aria-current="true" className="rounded-md bg-(--l-ink) px-2 py-1 text-(--l-paper)">
        {label}
      </span>
    ) : (
      // A full page load, not a client navigation: a link fetched ahead of time while the other
      // language was chosen holds a redirect back to it.
      <a
        href={href}
        hrefLang={l}
        lang={l}
        onClick={() => remember(l)}
        className="rounded-md px-2 py-1 text-(--l-muted) hover:bg-black/5 hover:text-(--l-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:hover:bg-white/10"
      >
        {label}
      </a>
    );
  return (
    <nav aria-label={lang === "am" ? "ቋንቋ" : "Language"} className={`flex items-center gap-0.5 text-xs font-medium ${className}`}>
      {item("en", en, "English")}
      {item("am", am, "አማርኛ")}
    </nav>
  );
}

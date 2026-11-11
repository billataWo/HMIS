import type { Lang } from "./i18n";

/**
 * The public site (front page, request, privacy, terms) in English at /welcome … and in Amharic
 * at /am/welcome …: separate addresses, so each page is prerendered once per language and a link
 * can be shared in either. The language switch also sets the `hmis_lang` cookie, which the sign-in
 * and the app use, and which sends a returning visitor to the pages in their language.
 */
export type { Lang };

export const PUBLIC_PAGES = ["/welcome", "/request", "/privacy", "/terms"] as const;

/** The same page in `lang`: "/request" → "/am/request". Other paths are left alone. */
export function inLang(lang: Lang, path: string) {
  const [base, rest = ""] = path.split(/(?=[?#])/);
  if (!PUBLIC_PAGES.some((p) => base === p)) return path;
  return lang === "am" ? `/am${base}${rest}` : `${base}${rest}`;
}

/** For each page's metadata: where it is in each language. */
export function alternates(path: (typeof PUBLIC_PAGES)[number], lang: Lang) {
  return { canonical: inLang(lang, path), languages: { en: path, am: `/am${path}` } };
}

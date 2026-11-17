/**
 * Interface language. English text is the key; the `am/` dictionaries hold the Amharic. Anything
 * not in a dictionary stays in English. Have a native speaker on the clinical team review new
 * entries before release.
 *
 * Writing a screen:
 * - server component: `const t = await getT();` (lib/lang.ts)
 * - client component: `const t = useT();` (components/lang-provider.tsx)
 * - `t("Save")`, `t("Queue number {n}", { n: 12 })`: a whole sentence per key, with `{name}` where a
 *   value goes, so the Amharic can put it where Amharic word order needs it.
 * - `t.rich("Pay the open invoice: {link}.", { link: <Link …>Subscription</Link> })` when a link or
 *   other element sits inside the sentence.
 * - Kept in English on purpose: drug, test and vaccine names, units, ICD codes, people's names and
 *   anything typed by staff.
 *
 * `pnpm --filter web i18n:check` lists keys with no Amharic and English text not yet passed to `t`.
 */
import { Fragment, createElement, type ReactNode } from "react";
import { AM } from "./i18n/am";

export type Lang = "en" | "am";

export const LANG_COOKIE = "hmis_lang";

export type Vars = Record<string, string | number | null | undefined>;

/** The text in the chosen language (English when there is no translation yet), values filled in. */
export function tr(lang: Lang, english: string, vars?: Vars) {
  const text = lang === "am" ? (AM[english] ?? english) : english;
  return vars ? text.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k] ?? "") : all)) : text;
}

/** Like `tr`, but each `{name}` may be an element (a link, a bold amount). */
export function trRich(lang: Lang, english: string, parts: Record<string, ReactNode>): ReactNode {
  const text = lang === "am" ? (AM[english] ?? english) : english;
  const pieces = text.split(/\{(\w+)\}/g);
  return createElement(
    Fragment,
    null,
    ...pieces.map((p, i) => createElement(Fragment, { key: i }, i % 2 ? (p in parts ? parts[p] : `{${p}}`) : p)),
  );
}

export type T = ((english: string, vars?: Vars) => string) & {
  rich: (english: string, parts: Record<string, ReactNode>) => ReactNode;
  lang: Lang;
};

export function makeT(lang: Lang): T {
  const t = ((english: string, vars?: Vars) => tr(lang, english, vars)) as T;
  t.rich = (english, parts) => trRich(lang, english, parts);
  t.lang = lang;
  return t;
}

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
import { AM, MESSAGES } from "./i18n/am";

export type Lang = "en" | "am";

export const LANG_COOKIE = "hmis_lang";

export type Vars = Record<string, string | number | null | undefined>;

/**
 * The server's messages with values in them ("Only {n} {unit} of {drug} are left to bill"), as
 * patterns: a message arrives already filled in, so it is matched rather than looked up. A `{_x}`
 * placeholder matches text the Amharic leaves out (an English plural "s").
 */
let patterns: { re: RegExp; names: string[]; am: string }[] | null = null;
function fromPattern(english: string): string | undefined {
  patterns ??= Object.entries(MESSAGES)
    .filter(([k]) => k.includes("{"))
    .map(([k, am]) => ({
      re: new RegExp(`^${k.split(/\{\w+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*?)")}$`, "s"),
      names: [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      am,
    }))
    // The most literal text first, so "This prescription is {status}" loses to a longer, closer key.
    .sort((a, b) => b.re.source.length - a.re.source.length);
  for (const p of patterns) {
    const m = p.re.exec(english);
    if (!m) continue;
    const values = Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]]));
    // A value that is itself a dictionary word ("cancelled") is translated too; names stay as they are.
    return p.am.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? (AM[values[k]] ?? values[k]) : all));
  }
  return undefined;
}

/** The text in the chosen language (English when there is no translation yet), values filled in. */
export function tr(lang: Lang, english: string, vars?: Vars) {
  const text = lang === "am" ? (AM[english] ?? (vars ? undefined : fromPattern(english)) ?? english) : english;
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

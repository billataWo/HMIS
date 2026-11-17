#!/usr/bin/env node
/**
 * Amharic coverage of the staff app.
 *
 *   node scripts/i18n-check.mjs              summary: per file, English text not passed to t();
 *                                            keys with no Amharic; placeholder mismatches; clashes
 *   node scripts/i18n-check.mjs <path part>  every finding in the files whose path contains it
 *
 * Exits 1 when a key used with t() has no Amharic, or a translation drops a {placeholder}.
 * Files that are English on purpose (the HMIS team's console, the public site, which has its own
 * Amharic copy) are skipped; a file can opt out with the comment `i18n: english-only`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const root = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const filter = process.argv[2];

const SKIP = [
  "app/platform/", // the HMIS team's own console
  "app/welcome/", "app/privacy/", "app/terms/", "app/request/", "app/am/", // public site: own copy files
  "components/site.tsx", "components/legal.tsx", "components/lang-switch.tsx",
  "lib/i18n/",
];
/** Props whose text is shown to people. */
const SHOWN_PROPS = new Set(["placeholder", "title", "aria-label", "alt", "label", "question", "yes", "no", "empty", "hint", "description", "confirm", "confirmLabel", "pending", "pendingLabel", "submitLabel", "heading", "note", "caption", "subtitle", "help"]);

/** Keys of data objects whose text is shown. */
const SHOWN_KEYS = new Set(["label", "title", "text", "description", "hint", "empty", "help", "detail", "note", "caption", "heading", "subtitle", "question", "placeholder", "body", "message", "what", "action", "short", "desc"]);
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const rel = (f) => relative(root, f).split(sep).join("/");
const parse = (f) => ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const letters = (s) => /[A-Za-z]{2,}/.test(s);
/** Shown text that is a word: codes and key names (HMIS, MRN, Ctrl K, 09XX…) are the same in Amharic. */
const UNITS = /\b(kg|cm|mm|mg|ml|mL|mmHg|min|kg\/m²|g\/dL|mmol\/L|mg\/dL|IU|µL|°C)\b/g;
const wordy = (s) => /[a-z]{2,}/.test(s.replace(UNITS, "")) && !/^(Ctrl|Alt|Esc|Enter|Shift|Tab)\b/.test(s);
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

// ── the dictionary ──────────────────────────────────────────────────────────────────────────────
const dict = new Map();
const clashes = [];
for (const f of walk(join(root, "lib/i18n/am")).filter((f) => f.endsWith(".ts") && !f.endsWith("index.ts"))) {
  ts.forEachChild(parse(f), function visit(n) {
    if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.initializer)) {
      const key = ts.isIdentifier(n.name) ? n.name.text : ts.isStringLiteral(n.name) ? n.name.text : null;
      if (key === null) return;
      const prev = dict.get(key);
      if (prev && prev.am !== n.initializer.text) clashes.push(`${key}: "${prev.am}" (${prev.file}) vs "${n.initializer.text}" (${rel(f)})`);
      dict.set(key, { am: n.initializer.text, file: rel(f) });
    }
    ts.forEachChild(n, visit);
  });
}

// ── the screens ─────────────────────────────────────────────────────────────────────────────────
const used = new Map(); // key → first place
const english = new Map(); // file → [line: text]
const isT = (e) =>
  (ts.isIdentifier(e) && (e.text === "t" || e.text === "tr")) ||
  (ts.isPropertyAccessExpression(e) && e.name.text === "rich" && ts.isIdentifier(e.expression) && e.expression.text === "t");
const lit = (e) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null);

for (const f of walk(root).filter((f) => /\.(tsx?|mjs)$/.test(f))) {
  const r = rel(f);
  if (SKIP.some((s) => r.startsWith(s) || r === s)) continue;
  const src = readFileSync(f, "utf8");
  if (src.includes("i18n: english-only")) continue;
  const sf = parse(f);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const found = [];
  // `i18n-ignore` on the line or the line above: English on purpose (a brand line, a sample).
  const lines = src.split("\n");
  // `i18n-ignore-start` … `i18n-ignore-end`: a block of English on purpose.
  const blocks = [];
  lines.forEach((l, i) => {
    if (/i18n-ignore-start/.test(l)) blocks.push([i + 1, Infinity]);
    if (/i18n-ignore-end/.test(l) && blocks.length) blocks.at(-1)[1] = i + 1;
  });
  const ignored = (n) =>
    /i18n-ignore/.test(lines[line(n) - 1] ?? "") || /i18n-ignore/.test(lines[line(n) - 2] ?? "") || blocks.some(([a, b]) => line(n) >= a && line(n) <= b);
  const push = (n, text) => !ignored(n) && found.push(`${line(n)}: ${text}`);
  const visit = (n) => {
    if (ts.isCallExpression(n) && isT(n.expression)) {
      // t("…"), t(x ? "…" : "…"), t(a ?? "…")
      const keys = (e) =>
        lit(e) !== null
          ? [lit(e)]
          : ts.isParenthesizedExpression(e)
            ? keys(e.expression)
            : ts.isConditionalExpression(e)
              ? [...keys(e.whenTrue), ...keys(e.whenFalse)]
              : ts.isBinaryExpression(e) && ["??", "||"].includes(e.operatorToken.getText())
                ? [...keys(e.left), ...keys(e.right)]
                : [];
      // tr(lang, "…"): the first argument is the language.
      const args = ts.isIdentifier(n.expression) && n.expression.text === "tr" ? n.arguments.slice(1) : n.arguments;
      for (const a of args) for (const k of keys(a)) if (letters(k) && !used.has(k)) used.set(k, `${r}:${line(a)}`);
      return; // what is inside t() is handled
    }
    // <PageTitle title="Patients" subtitle="…"> takes English keys and translates them itself.
    if (ts.isJsxAttribute(n) && ["title", "subtitle"].includes(n.name.getText())) {
      const el = n.parent?.parent;
      if (el && (ts.isJsxSelfClosingElement(el) || ts.isJsxOpeningElement(el)) && el.tagName.getText() === "PageTitle") {
        const k = n.initializer && lit(n.initializer);
        if (k && !used.has(k)) used.set(k, `${r}:${line(n)}`);
        return;
      }
    }
    // Not shown in the page: the browser tab's title (metadata) and CSS in <style>.
    if (ts.isVariableDeclaration(n) && n.name.getText() === "metadata") return;
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === "style") return;
    // Shown text kept in data: { label: "Waiting" }, { title: "Check in a patient", text: "…" }.
    // Fine once the dictionary has it (the screen passes it to t()); reported until then.
    if (ts.isPropertyAssignment(n) && SHOWN_KEYS.has(n.name.getText().replace(/["']/g, "")) && lit(n.initializer) !== null) {
      const v = lit(n.initializer);
      if (wordy(v) && !dict.has(v)) push(n, `${n.name.getText()}: "${v}"`);
    }
    if (ts.isJsxText(n)) {
      const s = n.text.replace(/\s+/g, " ").trim();
      if (wordy(s) && !/^&\w+;$/.test(s)) push(n, s);
    } else if (ts.isJsxAttribute(n) && SHOWN_PROPS.has(n.name.getText())) {
      const v = n.initializer && (lit(n.initializer) ?? (ts.isJsxExpression(n.initializer) ? lit(n.initializer.expression) : null));
      if (v && wordy(v)) push(n, `${n.name.getText()}="${v}"`);
    } else if (ts.isJsxExpression(n) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) && n.expression) {
      // Text chosen inside {…}: {x ? "Paid" : "Owes"}, {a ?? "None"}, {`${n} days`}. Literals
      // passed to other calls (formatters, ids) are not shown text.
      const shown = (e) => {
        if (lit(e) !== null) return letters(lit(e)) ? [lit(e)] : [];
        if (ts.isTemplateExpression(e)) return wordy([e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" ")) ? [e.getText()] : [];
        if (ts.isParenthesizedExpression(e)) return shown(e.expression);
        if (ts.isConditionalExpression(e)) return [...shown(e.whenTrue), ...shown(e.whenFalse)];
        if (ts.isBinaryExpression(e) && ["??", "||", "&&", "+"].includes(e.operatorToken.getText())) return [...shown(e.left), ...shown(e.right)];
        return [];
      };
      for (const v of shown(n.expression)) if (v.startsWith("`") || wordy(v)) push(n, `{${JSON.stringify(v)}}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (found.length) english.set(r, found);
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────
const missing = [...used].filter(([k]) => !dict.has(k));
const broken = [...used].filter(([k]) => dict.has(k) && holes(k) !== holes(dict.get(k).am));
const total = [...english.values()].reduce((a, b) => a + b.length, 0);

if (filter) {
  for (const [file, items] of english) if (file.includes(filter)) console.log(`\n${file}\n  ${items.join("\n  ")}`);
  const m = missing.filter(([, at]) => at.includes(filter));
  if (m.length) console.log(`\nNo Amharic yet:\n  ${m.map(([k, at]) => `${at}  ${JSON.stringify(k)}`).join("\n  ")}`);
} else {
  const rows = [...english].map(([file, items]) => [items.length, file]).sort((a, b) => b[0] - a[0]);
  console.log("English text not passed to t(), by file:");
  for (const [n, file] of rows) console.log(`  ${String(n).padStart(4)}  ${file}`);
  if (missing.length) console.log(`\nKeys with no Amharic (${missing.length}):\n  ${missing.map(([k, at]) => `${at}  ${JSON.stringify(k)}`).join("\n  ")}`);
}
if (broken.length) console.log(`\nAmharic with different {placeholders}:\n  ${broken.map(([k, at]) => `${at}  ${JSON.stringify(k)}`).join("\n  ")}`);
if (clashes.length) console.log(`\nSame key, different Amharic:\n  ${clashes.join("\n  ")}`);
console.log(`\n${dict.size} Amharic entries · ${used.size} keys used · ${missing.length} missing · ${total} English texts in ${english.size} files`);
process.exit(missing.length || broken.length ? 1 : 0);

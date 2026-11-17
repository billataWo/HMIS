"use client";

import { Download, FileUp } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { importDrugs } from "@/app/actions";
import { Alert, Badge, buttonClass, linkClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { NewDrug } from "@/lib/api";
import { csvCell, money, parseCsv } from "@/lib/csv";
import { FORMS } from "../../inventory-forms";
import { ControlledBadge } from "@/components/controlled-badge";
import { useT } from "@/components/lang-provider";

/** Column headings people actually use, in any case or spacing, mapped to the drug's fields. */
const HEADINGS: Record<string, keyof NewDrug> = {
  genericname: "genericName",
  generic: "genericName",
  name: "genericName",
  drug: "genericName",
  brand: "brandName",
  brandname: "brandName",
  class: "drugClass",
  drugclass: "drugClass",
  form: "form",
  dosageform: "form",
  strength: "strength",
  unit: "unit",
  dispensingunit: "unit",
  price: "sellPrice",
  sellprice: "sellPrice",
  sellingprice: "sellPrice",
  priceperunit: "sellPrice",
  reorder: "reorderLevel",
  reorderlevel: "reorderLevel",
  reorderat: "reorderLevel",
  pack: "packName",
  packname: "packName",
  boughtin: "packName",
  packsize: "packSize",
  unitsperpack: "packSize",
  controlled: "controlled",
  schedule: "controlled",
};

const TEMPLATE = [
  ["Generic name", "Brand name", "Class", "Form", "Strength", "Unit", "Price per unit", "Reorder level", "Pack", "Units per pack", "Controlled"],
  ["Paracetamol", "", "analgesic", "tablet", "500 mg", "tablet", "2.00", "200", "box", "100", ""],
  ["Amoxicillin", "Amoxil", "penicillin", "suspension", "250 mg/5 ml", "bottle", "85.00", "10", "", "", ""],
  ["Tramadol", "", "opioid", "capsule", "50 mg", "capsule", "3.00", "50", "box", "100", "narcotic"],
];
const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + TEMPLATE.map((r) => r.map(csvCell).join(",")).join("\r\n"))}`;

type Row = { line: number; drug?: NewDrug; problems: string[] };

function readRows(text: string): { rows: Row[]; unknown: string[]; missing: string[] } {
  const [head = [], ...body] = parseCsv(text);
  const cols = head.map((h) => HEADINGS[h.toLowerCase().replace(/[^a-z]/g, "")]);
  const unknown = head.filter((h, i) => h.trim() && !cols[i]);
  const missing = (["genericName", "form", "unit", "sellPrice"] as const).filter((f) => !cols.includes(f));
  const rows = body.map((cells, n): Row => {
    const get = (f: keyof NewDrug) => {
      const i = cols.indexOf(f);
      return i < 0 ? "" : (cells[i] ?? "").trim();
    };
    const problems: string[] = [];
    const name = get("genericName");
    if (name.length < 2) problems.push("no generic name");
    const form = get("form").toLowerCase();
    if (!FORMS.includes(form)) problems.push(form ? `form "${get("form")}": ${FORMS.join(", ")}` : "no form");
    const unit = get("unit");
    if (!unit) problems.push("no unit");
    const priceText = money(get("sellPrice"));
    const price = Number(priceText);
    if (priceText === "" || !Number.isFinite(price) || price < 0) problems.push("no valid price");
    const reorderText = get("reorderLevel");
    const reorder = reorderText ? Number(reorderText) : 0;
    if (!Number.isInteger(reorder) || reorder < 0) problems.push("reorder level must be a whole number");
    const ctl = get("controlled").toLowerCase();
    const controlled: NewDrug["controlled"] | undefined =
      !ctl || ["no", "n/a", "-"].includes(ctl) ? null : /^narc/.test(ctl) ? "NARCOTIC" : /^psych/.test(ctl) ? "PSYCHOTROPIC" : undefined;
    if (controlled === undefined) problems.push(`controlled "${get("controlled")}": narcotic, psychotropic, —`);
    const packText = get("packSize");
    const packSize = packText ? Number(packText) : null;
    if (packSize !== null && (!Number.isInteger(packSize) || packSize < 2)) problems.push("units per pack must be a whole number of 2 or more");
    return {
      line: n + 2, // the heading is line 1
      problems,
      drug: problems.length
        ? undefined
        : {
            genericName: name,
            brandName: get("brandName") || null,
            drugClass: get("drugClass") || null,
            form,
            strength: get("strength") || null,
            unit,
            sellPrice: Math.round(price * 100) / 100,
            reorderLevel: reorder,
            packSize,
            packName: packSize ? get("packName") || "pack" : null,
            controlled: controlled ?? null,
          },
    };
  });
  return { rows, unknown, missing };
}

export function DrugImport() {
  const [file, setFile] = useState<string>();
  const [data, setData] = useState<ReturnType<typeof readRows>>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ created: string[]; skipped: string[] }>();
  const [pending, start] = useTransition();
  const good = data?.rows.filter((r) => r.drug) ?? [];
  const bad = data?.rows.filter((r) => !r.drug) ?? [];
  const t = useT();

  const load = async (f: File | undefined) => {
    setError(undefined);
    setDone(undefined);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setError(t("Save the spreadsheet as CSV first (Excel: File → Save As → CSV UTF-8), then choose that file."));
      setData(undefined);
      return;
    }
    setFile(f.name);
    setData(readRows(await f.text()));
  };

  const submit = () =>
    start(async () => {
      // The API takes up to 500 drugs at a time.
      const total = { created: [] as string[], skipped: [] as string[] };
      for (let from = 0; from < good.length; from += 500) {
        const chunk = good.slice(from, from + 500);
        const res = await importDrugs(chunk.map((r) => r.drug!));
        if ("error" in res) {
          // Map the server's row numbers (in what was sent) back to the file's lines.
          const lines = Object.entries(res.rows ?? {}).map(([i, msg]) => t("line {n}: {problem}", { n: chunk[Number(i)]?.line ?? "", problem: t(msg) }));
          setError([t(res.error), ...lines, total.created.length ? t("({n} drugs before it were added.)", { n: total.created.length }) : ""].join(" "));
          return;
        }
        total.created.push(...res.created);
        total.skipped.push(...res.skipped);
      }
      setDone(total);
      setData(undefined);
      setFile(undefined);
    });

  return (
    <div className="max-w-5xl space-y-5">
      <section className="surface space-y-3 p-5 text-sm">
        <ol className="list-decimal space-y-1.5 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            {t.rich("Put one drug per row with these columns: {required}, and if you have them Brand name, Class, Strength, Reorder level, Pack, Units per pack, Controlled (narcotic or psychotropic).", {
              required: <strong>Generic name, Form, Unit, Price per unit</strong>,
            })}{" "}
            <a href={templateHref} download="hmis-drug-list.csv" className={`${linkClass} inline-flex items-center gap-1`}>
              <Download aria-hidden className="size-3.5" />
              {t("Download a template")}
            </a>
          </li>
          <li>{t("Form is one of: {list}. Prices are in ETB per unit (per tablet, per bottle).", { list: FORMS.join(", ") })}</li>
          <li>{t("In Excel choose File → Save As → CSV UTF-8; in Google Sheets File → Download → CSV. Then choose the file below.")}</li>
        </ol>
        <label className={`${secondaryButtonClass} cursor-pointer`}>
          <FileUp aria-hidden />
          {file ? t("Choose another file ({file})", { file }) : t("Choose CSV file")}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => load(e.target.files?.[0])} aria-label={t("CSV file")} />
        </label>
      </section>

      {error && <Alert>{error}</Alert>}
      {done && (
        <Notice tone="success">
          {t(done.created.length === 1 ? "Added {n} drug." : "Added {n} drugs.", { n: done.created.length })}
          {done.skipped.length > 0 && ` ${t("{n} were already in your list and were left as they are.", { n: done.skipped.length })}`}{" "}
          <Link href="/inventory" className="font-medium underline">
            {t("See the inventory")}
          </Link>
        </Notice>
      )}

      {data && (
        <section className="space-y-3">
          {data.missing.length > 0 && (
            <Alert>
              {t("The file has no column for: {list}. Check the first row holds the column headings.", {
                list: data.missing.map((m) => ({ genericName: "Generic name", form: "Form", unit: "Unit", sellPrice: "Price per unit" })[m as string]).join(", "),
              })}
            </Alert>
          )}
          {data.unknown.length > 0 && <p className="text-xs text-slate-500">{t("Columns not used: {list}", { list: data.unknown.join(", ") })}</p>}
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success">{t("{n} ready", { n: good.length })}</Badge>
            {bad.length > 0 && <Badge tone="danger">{t("{n} need fixing in the file", { n: bad.length })}</Badge>}
            <span className="text-slate-500">{t("Drugs already in your list are skipped.")}</span>
          </p>
          <div className="surface max-h-112 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("Line")}</th>
                  <th className="px-3 py-2 font-medium">{t("Drug")}</th>
                  <th className="px-3 py-2 font-medium">{t("Unit")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Price")}</th>
                  <th className="px-3 py-2 font-medium">{t("Pack")}</th>
                  <th className="px-3 py-2 font-medium">{t("Check")}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.line} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-3 py-1.5 tabular-nums text-slate-500">{r.line}</td>
                    <td className="px-3 py-1.5">
                      {r.drug ? (
                        <>
                          <span className="font-medium">{r.drug.genericName}</span> {r.drug.strength} {r.drug.form} <ControlledBadge c={r.drug.controlled} />
                          {r.drug.brandName && <span className="text-slate-500"> ({r.drug.brandName})</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5">{r.drug?.unit}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.drug ? r.drug.sellPrice.toFixed(2) : ""}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{r.drug?.packSize ? t("{pack} of {n}", { pack: r.drug.packName ?? "", n: r.drug.packSize }) : ""}</td>
                    <td className="px-3 py-1.5">
                      {r.drug ? <span className="text-emerald-700 dark:text-emerald-400">OK</span> : <span className="text-red-700 dark:text-red-400">{r.problems.map((p) => t(p)).join("; ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={pending || good.length === 0 || data.missing.length > 0} onClick={submit} className={buttonClass}>
            {pending ? t("Importing…") : t(good.length === 1 ? "Import {n} drug" : "Import {n} drugs", { n: good.length })}
          </button>
        </section>
      )}
    </div>
  );
}

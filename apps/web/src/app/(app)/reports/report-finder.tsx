"use client";

import { ArrowRight, Banknote, ClipboardList, FileText, Package, Search, Stethoscope, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { inputClass } from "@/components/ui";

const ICONS: Record<string, LucideIcon> = { money: Banknote, clinical: Stethoscope, pharmacy: Package, operations: Users, submissions: ClipboardList };

export type FinderGroup = {
  key: string;
  title: string;
  description: string;
  items: { href: string; title: string; description: string; asOfNow?: boolean }[];
};

/** The report library: every report by area, with a search over names and descriptions. */
export function ReportFinder({ groups }: { groups: FinderGroup[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => words.every((w) => `${i.title} ${i.description} ${g.title}`.toLowerCase().includes(w))) }))
    .filter((g) => g.items.length);

  return (
    <div className="space-y-8">
      <div className="relative max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Find a report")}
          aria-label={t("Find a report")}
          className={`${inputClass} w-full pl-9`}
        />
      </div>

      {shown.length === 0 && <p className="text-sm text-slate-500">{t("No report matches that.")}</p>}

      {shown.map((g) => {
        const Icon = ICONS[g.key] ?? FileText;
        return (
          <section key={g.key} aria-labelledby={`cat-${g.key}`} className="space-y-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <Icon className="size-4" />
              </span>
              <div>
                <h2 id={`cat-${g.key}`} className="font-semibold text-slate-900 dark:text-white">
                  {g.title}
                </h2>
                <p className="text-xs text-slate-500">{g.description}</p>
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className="group surface flex h-full flex-col p-4 transition-[border-color,box-shadow] duration-150 hover:border-brand-600/40 hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{i.title}</span>
                      <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600 dark:text-slate-600" />
                    </span>
                    <span className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{i.description}</span>
                    {i.asOfNow && <span className="mt-2 text-xs font-medium text-brand-700 dark:text-brand-300">{t("As of now")}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

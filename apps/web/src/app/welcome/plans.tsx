"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { buttonClass, secondaryButtonClass } from "@/components/ui";
import { etb } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { inLang } from "@/lib/site-lang";

const COPY = {
  en: {
    period: "Billing period",
    monthly: "Monthly",
    yearly: "Yearly",
    yearlySave: (p: number) => `Yearly · save up to ${p}%`,
    featured: "Most clinics choose this",
    month: "month",
    year: "year",
    less: (x: string) => `${x} less than paying monthly`,
    orYear: (x: string) => `or ${x} a year`,
    staff: (n: number) => `Up to ${n} staff accounts`,
    anyStaff: "Any number of staff accounts",
    core: "Queue, consultation, lab, pharmacy, billing and reports",
    start: (d: number) => `Start the ${d}-day free trial`,
  },
  am: {
    period: "የክፍያ ጊዜ",
    monthly: "ወርሃዊ",
    yearly: "ዓመታዊ",
    yearlySave: (p: number) => `ዓመታዊ · እስከ ${p}% ይቆጥቡ`,
    featured: "ብዙ ክሊኒኮች ይህን ይመርጣሉ",
    month: "ወር",
    year: "ዓመት",
    less: (x: string) => `ወርሃዊ ከመክፈል ${x} ያነሰ`,
    orYear: (x: string) => `ወይም በዓመት ${x}`,
    staff: (n: number) => `እስከ ${n} የሰራተኛ መለያዎች`,
    anyStaff: "ያልተገደበ የሰራተኛ መለያዎች",
    core: "ወረፋ፣ የሐኪም ምርመራ፣ ላብራቶሪ፣ ፋርማሲ፣ ክፍያና ሪፖርቶች",
    start: (d: number) => `የ${d} ቀን ነፃ ሙከራ ይጀምሩ`,
  },
} satisfies Record<Lang, unknown>;

export interface Plan {
  code: string;
  name: string;
  description: string | null;
  priceMonthly: string;
  priceYearly: string;
  maxStaff: number | null;
  features: string[];
}

/** The plans, priced monthly or yearly. The middle one of three is marked as the usual choice. */
export function Plans({ plans, features, trialDays, lang = "en" }: { plans: Plan[]; features: Record<string, string>; trialDays: number; lang?: Lang }) {
  const t = COPY[lang];
  const [yearly, setYearly] = useState(false);
  const saving = (p: Plan) => Math.max(0, Number(p.priceMonthly) * 12 - Number(p.priceYearly));
  const anySaving = plans.some((p) => saving(p) > 0);
  // The best yearly discount, as a whole percentage, for the switch's label.
  const bestPercent = Math.max(0, ...plans.map((p) => (Number(p.priceMonthly) > 0 ? Math.floor((saving(p) / (Number(p.priceMonthly) * 12)) * 100) : 0)));
  const featured = plans.length === 3 ? plans[1].code : null;

  return (
    <div>
      <div role="radiogroup" aria-label={t.period} className="mx-auto flex w-fit rounded-xl bg-slate-100 p-1 text-sm dark:bg-slate-800">
        {[
          { value: false, label: t.monthly },
          { value: true, label: anySaving && bestPercent > 0 ? t.yearlySave(bestPercent) : t.yearly },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={yearly === o.value}
            onClick={() => setYearly(o.value)}
            className={`relative min-h-10 rounded-lg px-4 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              yearly === o.value ? "text-slate-900 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            {/* The white pill slides to the chosen period. */}
            {yearly === o.value && (
              <motion.span layoutId="billing-period" aria-hidden className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-slate-950" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />
            )}
            <span className="relative">{o.label}</span>
          </button>
        ))}
      </div>

      <div className={`land-stagger mt-8 grid gap-5 ${plans.length >= 3 ? "lg:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2" : ""}`}>
        {plans.map((p) => {
          const isFeatured = p.code === featured;
          return (
            <div key={p.code} className={`surface land-lift relative flex flex-col p-6 ${isFeatured ? "ring-2 ring-brand-600 lg:-my-2 lg:py-8 dark:ring-brand-400" : ""}`}>
              {isFeatured && (
                <span className="absolute -top-3 left-6 rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-medium text-white">{t.featured}</span>
              )}
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{p.name}</h3>
              {p.description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.description}</p>}
              <p className="mt-5 flex items-baseline overflow-hidden text-3xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">
                {/* The new price rises in as the old one leaves. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={yearly ? "y" : "m"}
                    initial={{ y: 14, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -14, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {etb(yearly ? p.priceYearly : p.priceMonthly)}
                  </motion.span>
                </AnimatePresence>
                <span className="ml-1 text-sm font-normal tracking-normal text-(--l-muted)">/ {yearly ? t.year : t.month}</span>
              </p>
              <p className="mt-1 h-5 text-xs text-(--l-muted)">
                {yearly ? (saving(p) > 0 ? t.less(etb(saving(p))) : "") : t.orYear(etb(p.priceYearly))}
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {p.maxStaff ? t.staff(p.maxStaff) : t.anyStaff}
                </li>
                <li className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {t.core}
                </li>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    {features[f] ?? f}
                  </li>
                ))}
              </ul>
              <Link
                href={inLang(lang, `/request?plan=${encodeURIComponent(p.code)}`)}
                className={`${isFeatured ? buttonClass : secondaryButtonClass} mt-6 w-full justify-center`}
              >
                {t.start(trialDays)}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

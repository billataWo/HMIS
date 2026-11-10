"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClass, secondaryButtonClass } from "@/components/ui";
import { etb } from "@/lib/format";

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
export function Plans({ plans, features, trialDays }: { plans: Plan[]; features: Record<string, string>; trialDays: number }) {
  const [yearly, setYearly] = useState(false);
  const saving = (p: Plan) => Math.max(0, Number(p.priceMonthly) * 12 - Number(p.priceYearly));
  const anySaving = plans.some((p) => saving(p) > 0);
  const featured = plans.length === 3 ? plans[1].code : null;

  return (
    <div>
      <div role="radiogroup" aria-label="Billing period" className="mx-auto flex w-fit rounded-xl bg-slate-100 p-1 text-sm dark:bg-slate-800">
        {[
          { value: false, label: "Monthly" },
          { value: true, label: anySaving ? "Yearly · save" : "Yearly" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={yearly === o.value}
            onClick={() => setYearly(o.value)}
            className={`rounded-lg px-4 py-1.5 font-medium transition-colors ${
              yearly === o.value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className={`mt-8 grid gap-5 ${plans.length >= 3 ? "lg:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2" : ""}`}>
        {plans.map((p) => {
          const isFeatured = p.code === featured;
          return (
            <div key={p.code} className={`surface relative flex flex-col p-6 ${isFeatured ? "ring-2 ring-brand-600 dark:ring-brand-400" : ""}`}>
              {isFeatured && (
                <span className="absolute -top-3 left-6 rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-medium text-white">Most clinics choose this</span>
              )}
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{p.name}</h3>
              {p.description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.description}</p>}
              <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">
                {etb(yearly ? p.priceYearly : p.priceMonthly)}
                <span className="text-sm font-normal tracking-normal text-slate-500"> / {yearly ? "year" : "month"}</span>
              </p>
              <p className="mt-1 h-5 text-xs text-slate-500">
                {yearly ? (saving(p) > 0 ? `${etb(saving(p))} less than paying monthly` : "") : `or ${etb(p.priceYearly)} a year`}
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {p.maxStaff ? `Up to ${p.maxStaff} staff accounts` : "Any number of staff accounts"}
                </li>
                <li className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  Queue, consultation, lab, pharmacy, billing and reports
                </li>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    {features[f] ?? f}
                  </li>
                ))}
              </ul>
              <Link
                href={`/request?plan=${encodeURIComponent(p.code)}`}
                className={`${isFeatured ? buttonClass : secondaryButtonClass} mt-6 w-full justify-center`}
              >
                Start the {trialDays}-day free trial
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

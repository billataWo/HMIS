"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { importDrugs } from "@/app/actions";
import { Alert, buttonClass, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { FormularyDrug } from "@/lib/api";
import { packLabel } from "@/lib/packs";
import { ControlledBadge } from "@/components/controlled-badge";

type Pick = { price: string; reorder: string };

const label = (d: FormularyDrug) => [d.genericName, d.strength, d.form].filter(Boolean).join(" ");

/**
 * Tick the medicines the clinic stocks and give each its selling price per unit. A price is
 * required: 0 (free, e.g. programme drugs) has to be typed on purpose, because a free drug never
 * waits for the cashier.
 */
export function StarterPicker({ drugs }: { drugs: FormularyDrug[] }) {
  const [picked, setPicked] = useState<Record<number, Pick>>({});
  const [error, setError] = useState<string>();
  const [missing, setMissing] = useState<number[]>([]);
  const [done, setDone] = useState<{ created: string[]; skipped: string[] }>();
  const [pending, start] = useTransition();
  const groups = [...new Set(drugs.map((d) => d.group))];
  const chosen = Object.keys(picked).map(Number);

  const toggle = (i: number, on: boolean) =>
    setPicked((p) => {
      const next = { ...p };
      if (on) next[i] = p[i] ?? { price: "", reorder: "" };
      else delete next[i];
      return next;
    });
  const set = (i: number, patch: Partial<Pick>) => {
    setPicked((p) => ({ ...p, [i]: { ...p[i], ...patch } }));
    if (patch.price?.trim()) setMissing((m) => m.filter((x) => x !== i));
  };

  const submit = () => {
    const noPrice = chosen.filter((i) => picked[i].price.trim() === "" || !(Number(picked[i].price) >= 0));
    setMissing(noPrice);
    if (noPrice.length) {
      setError(`Set a selling price for ${noPrice.length === 1 ? label(drugs[noPrice[0]]) : `${noPrice.length} drugs`} (type 0 only for a free drug).`);
      return;
    }
    setError(undefined);
    start(async () => {
      const res = await importDrugs(
        chosen.map((i) => {
          const d = drugs[i];
          return {
            genericName: d.genericName,
            strength: d.strength,
            form: d.form,
            unit: d.unit,
            drugClass: d.drugClass,
            sellPrice: Number(picked[i].price),
            reorderLevel: Number(picked[i].reorder || 0),
            packSize: d.packSize ?? null,
            packName: d.packName ?? null,
            controlled: d.controlled ?? null,
          };
        }),
      );
      if ("error" in res) setError(res.error);
      else {
        setDone(res);
        setPicked({});
      }
    });
  };

  return (
    <div className="space-y-6 pb-24">
      {done && (
        <Notice tone="success">
          Added {done.created.length} {done.created.length === 1 ? "drug" : "drugs"} to your list
          {done.skipped.length > 0 && ` (${done.skipped.length} already there)`}.{" "}
          <Link href="/inventory/receive" className="font-medium underline">
            Receive stock for them
          </Link>
        </Notice>
      )}
      {groups.map((g) => (
        <section key={g} className="surface overflow-hidden">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900 dark:border-slate-800 dark:text-white">{g}</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {drugs.map((d, i) =>
              d.group !== g ? null : (
                <li key={i} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm ${d.inList ? "opacity-60" : ""}`}>
                  <label className="flex min-w-60 flex-1 items-center gap-3">
                    {d.inList ? (
                      <Check aria-label="Already in your list" className="size-4 text-emerald-600" />
                    ) : (
                      <input type="checkbox" checked={i in picked} onChange={(e) => toggle(i, e.target.checked)} aria-label={`Add ${label(d)}`} />
                    )}
                    <span>
                      <span className="font-medium">{label(d)}</span> <ControlledBadge c={d.controlled} />
                      <span className="block text-xs text-slate-500">
                        {[d.drugClass, packLabel(d) && `bought by the ${packLabel(d)}`, d.inList && "already in your list"].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                  {i in picked && (
                    <span className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">
                        Price per {d.unit}
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={picked[i].price}
                          onChange={(e) => set(i, { price: e.target.value })}
                          aria-label={`Selling price of ${label(d)}`}
                          aria-invalid={missing.includes(i)}
                          className={`${inputClass} w-24 ${missing.includes(i) ? "border-red-400!" : ""}`}
                        />
                        ETB
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">
                        Reorder at
                        <input
                          type="number"
                          min={0}
                          value={picked[i].reorder}
                          onChange={(e) => set(i, { reorder: e.target.value })}
                          aria-label={`Reorder level of ${label(d)}`}
                          placeholder="0"
                          className={`${inputClass} w-20`}
                        />
                      </label>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        </section>
      ))}

      {/* Stays in reach while scrolling the list. */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-raised backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        {error && (
          <div className="w-full">
            <Alert>{error}</Alert>
          </div>
        )}
        <button type="button" disabled={pending || chosen.length === 0} onClick={submit} className={buttonClass}>
          {pending ? "Adding…" : chosen.length ? `Add ${chosen.length} ${chosen.length === 1 ? "drug" : "drugs"}` : "Tick the drugs you stock"}
        </button>
        <Link href="/inventory" className={secondaryButtonClass}>
          Back to inventory
        </Link>
      </div>
    </div>
  );
}

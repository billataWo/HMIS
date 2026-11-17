"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { createPurchaseOrder, searchDrugs, type FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { InventoryRow, Supplier } from "@/lib/api";
import { packLabel } from "@/lib/packs";

type Line = { id: string; label: string; unit: string; suggested: number; onHand?: number; reorderLevel?: number; packSize?: number | null; packName?: string | null };

export function OrderForm({ suppliers, lowStock }: { suppliers: Supplier[]; lowStock: InventoryRow[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPurchaseOrder, {});
  // Low-stock drugs start on the order: enough to get back to twice the reorder level.
  const [lines, setLines] = useState<Line[]>(
    lowStock.map((d) => ({
      id: d.id,
      label: [d.genericName, d.strength, d.form].filter(Boolean).join(" "),
      unit: d.unit,
      suggested: Math.max(d.reorderLevel * 2 - d.onHand, 1),
      onHand: d.onHand,
      reorderLevel: d.reorderLevel,
      packSize: d.packSize,
      packName: d.packName,
    })),
  );
  // Lines counted in packs (box of 100) rather than units; drugs with a pack size start in packs.
  const [unitsFor, setUnitsFor] = useState<Record<string, boolean>>({});
  const byPack = (l: Line) => !!l.packSize && !unitsFor[l.id];
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Line[]>([]);
  const results = q.trim().length < 2 ? [] : found.filter((f) => !lines.some((l) => l.id === f.id));
  const t = useT();

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await searchDrugs(q);
      if (!cancelled) setFound(r.map((d) => ({ id: d.id, label: [d.genericName, d.strength, d.form].filter(Boolean).join(" "), unit: d.unit, suggested: 1, onHand: d.inStock, packSize: d.packSize, packName: d.packName })));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  if (!suppliers.length) {
    return (
      <p className="text-sm text-slate-500">
        {t("Add a supplier first.")}{" "}
        <Link href="/inventory/suppliers" className="text-brand-700 underline">
          {t("Suppliers")}
        </Link>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state.error && <Alert>{t(state.error)}</Alert>}
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label={t("Supplier")}>
          <select name="supplierId" required defaultValue={state.values?.supplierId ?? ""} className={inputClass}>
            <option value="" disabled>
              {t("Choose a supplier…")}
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Note for the supplier")}>
          <Input name="note" defaultValue={state.values?.note} placeholder={t("e.g. deliver by Friday")} />
        </Field>
      </div>

      <div className="relative max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Add a drug")} aria-label={t("Add a drug")} className={`${inputClass} pl-9`} />
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm shadow-raised dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => (setLines((ls) => [...ls, r]), setQ(""))} className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                  {r.label} <span className="text-slate-500">· {t("{n} in stock", { n: r.onHand ?? 0 })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="surface overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
            <tr>
              <th className="px-4 py-3">{t("Drug")}</th>
              <th className="px-4 py-3 text-right">{t("In stock / reorder at")}</th>
              <th className="px-4 py-3">{t("Order quantity")}</th>
              <th className="px-4 py-3">{t("Expected cost (ETB)")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  {t("Nothing is low on stock. Add drugs with the search above.")}
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-2">{l.label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">
                  {l.onHand ?? "—"} / {l.reorderLevel ?? "—"} {l.unit}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      key={byPack(l) ? "pack" : "unit"}
                      name={`qty_${l.id}`}
                      type="number"
                      min={0}
                      defaultValue={state.values?.[`qty_${l.id}`] ?? (byPack(l) ? Math.ceil(l.suggested / l.packSize!) : l.suggested)}
                      aria-label={t("Quantity of {drug}", { drug: l.label })}
                      className="w-28"
                    />
                    {l.packSize ? (
                      <>
                        <input type="hidden" name={`pack_${l.id}`} value={byPack(l) ? l.packSize : 1} />
                        <select
                          value={byPack(l) ? "pack" : "unit"}
                          onChange={(e) => setUnitsFor((u) => ({ ...u, [l.id]: e.target.value === "unit" }))}
                          aria-label={t("Count {drug} in", { drug: l.label })}
                          className={`${inputClass} w-auto py-1.5 text-xs`}
                        >
                          <option value="pack">{packLabel({ ...l, unit: l.unit })}</option>
                          <option value="unit">{l.unit}</option>
                        </select>
                      </>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <Input name={`cost_${l.id}`} type="number" min={0} step="0.01" defaultValue={state.values?.[`cost_${l.id}`]} aria-label={t("Unit cost of {drug}", { drug: l.label })} className="w-28" />
                  <span className="mt-1 block text-xs text-slate-500">{t("per {unit}", { unit: byPack(l) ? l.packName || t("pack") : l.unit })}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label={t("Remove {drug}", { drug: l.label })} className="rounded p-1 text-slate-500 hover:text-red-700">
                    <X aria-hidden className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={pending || lines.length === 0} className={buttonClass}>
          {pending ? t("Saving…") : t("Save draft order")}
        </button>
        <Link href="/inventory/orders" className={secondaryButtonClass}>
          {t("Cancel")}
        </Link>
      </div>
    </form>
  );
}

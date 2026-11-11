"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { createPurchaseOrder, searchDrugs, type FormState } from "@/app/actions";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { InventoryRow, Supplier } from "@/lib/api";

type Line = { id: string; label: string; unit: string; suggested: number; onHand?: number; reorderLevel?: number };

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
    })),
  );
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Line[]>([]);
  const results = q.trim().length < 2 ? [] : found.filter((f) => !lines.some((l) => l.id === f.id));

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchDrugs(q);
      if (!cancelled) setFound(r.map((d) => ({ id: d.id, label: [d.genericName, d.strength, d.form].filter(Boolean).join(" "), unit: d.unit, suggested: 1, onHand: d.inStock })));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  if (!suppliers.length) {
    return (
      <p className="text-sm text-slate-500">
        Add a supplier first.{" "}
        <Link href="/inventory/suppliers" className="text-brand-700 underline">
          Suppliers
        </Link>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Supplier">
          <select name="supplierId" required defaultValue={state.values?.supplierId ?? ""} className={inputClass}>
            <option value="" disabled>
              Choose a supplier…
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note for the supplier">
          <Input name="note" defaultValue={state.values?.note} placeholder="e.g. deliver by Friday" />
        </Field>
      </div>

      <div className="relative max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a drug" aria-label="Add a drug" className={`${inputClass} pl-9`} />
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm shadow-raised dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => (setLines((ls) => [...ls, r]), setQ(""))} className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                  {r.label} <span className="text-slate-500">· {r.onHand} in stock</span>
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
              <th className="px-4 py-3">Drug</th>
              <th className="px-4 py-3 text-right">In stock / reorder at</th>
              <th className="px-4 py-3">Order quantity</th>
              <th className="px-4 py-3">Expected unit cost (ETB)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Nothing is low on stock. Add drugs with the search above.
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
                  <Input name={`qty_${l.id}`} type="number" min={0} defaultValue={state.values?.[`qty_${l.id}`] ?? l.suggested} aria-label={`Quantity of ${l.label}`} className="w-28" />
                </td>
                <td className="px-4 py-2">
                  <Input name={`cost_${l.id}`} type="number" min={0} step="0.01" defaultValue={state.values?.[`cost_${l.id}`]} aria-label={`Unit cost of ${l.label}`} className="w-28" />
                </td>
                <td className="px-2 py-2 text-right">
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label={`Remove ${l.label}`} className="rounded p-1 text-slate-500 hover:text-red-700">
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
          {pending ? "Saving…" : "Save draft order"}
        </button>
        <Link href="/inventory/orders" className={secondaryButtonClass}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

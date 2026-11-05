"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { receiveStock, searchDrugs } from "@/app/actions";
import { Alert, buttonClass, Field, inputClass, secondaryButtonClass } from "@/components/ui";
import type { DrugOption, Supplier } from "@/lib/api";

type Line = { drug: DrugOption; batchNo: string; expiryDate: string; quantity: string; costPrice: string };

export function ReceiveForm({ suppliers, preset, minExpiry }: { suppliers: Supplier[]; preset?: DrugOption; minExpiry: string }) {
  const [supplierId, setSupplierId] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [lines, setLines] = useState<Line[]>(preset ? [{ drug: preset, batchNo: "", expiryDate: "", quantity: "", costPrice: "" }] : []);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DrugOption[]>([]);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ received: number; warnings: string[] }>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchDrugs(q);
      if (!cancelled) setResults(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.costPrice || 0), 0);

  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = await receiveStock({
        supplierId: supplierId || undefined,
        receiptRef: receiptRef || undefined,
        items: lines.map((l) => ({ drugId: l.drug.id, batchNo: l.batchNo, expiryDate: l.expiryDate, quantity: Number(l.quantity), costPrice: Number(l.costPrice) })),
      });
      if (res.error) setError(res.error);
      else {
        setDone({ received: res.received ?? 0, warnings: res.warnings ?? [] });
        setLines([]);
        setReceiptRef("");
      }
    });

  if (done) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          Received {done.received} {done.received === 1 ? "line" : "lines"} into stock.
        </p>
        {done.warnings.length > 0 && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p className="font-medium">Check these prices:</p>
            <ul className="list-disc pl-5">
              {done.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => setDone(undefined)} className={buttonClass}>
            Receive another delivery
          </button>
          <Link href="/inventory" className={secondaryButtonClass}>
            Back to inventory
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
            <option value="">Not specified</option>
            {suppliers
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Supplier invoice / delivery note no.">
          <input value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} className={inputClass} />
        </Field>
      </div>

      {lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Drug</th>
                <th className="px-3 py-2 font-medium">Batch no.</th>
                <th className="px-3 py-2 font-medium">Expiry</th>
                <th className="px-3 py-2 font-medium">Quantity</th>
                <th className="px-3 py-2 font-medium">Cost / unit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <span className="font-medium">{l.drug.genericName}</span> {l.drug.strength}
                    <span className="block text-xs text-zinc-500">
                      sells at {Number(l.drug.sellPrice).toFixed(2)} / {l.drug.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input value={l.batchNo} onChange={(e) => update(i, { batchNo: e.target.value })} aria-label="Batch number" className={`${inputClass} w-28`} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" min={minExpiry} value={l.expiryDate} onChange={(e) => update(i, { expiryDate: e.target.value })} aria-label="Expiry date" className={`${inputClass} w-40`} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={1} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} aria-label="Quantity" className={`${inputClass} w-24`} />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.costPrice}
                      onChange={(e) => update(i, { costPrice: e.target.value })}
                      aria-label="Cost per unit"
                      className={`${inputClass} w-24 ${l.costPrice && Number(l.costPrice) > Number(l.drug.sellPrice) ? "border-amber-500" : ""}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-red-700 hover:underline dark:text-red-400">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a drug to this delivery…" aria-label="Search drugs" className={inputClass} />
        {results.length > 0 && (
          <ul className="max-h-60 overflow-y-auto rounded-md border border-zinc-200 text-sm dark:border-zinc-800">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setLines((ls) => [...ls, { drug: r, batchNo: "", expiryDate: "", quantity: "", costPrice: "" }]);
                    setQ("");
                    setResults([]);
                  }}
                  className="flex w-full justify-between px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>
                    {r.genericName} {r.strength} {r.form}
                  </span>
                  <span className="text-xs text-zinc-500">{r.inStock} in stock</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && results.length === 0 && (
          <p className="text-xs text-zinc-500">
            Not in the drug list.{" "}
            <Link href="/inventory/drugs/new" className="text-teal-700 underline dark:text-teal-400">
              Add it first
            </Link>
          </p>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {lines.length > 0 && (
        <div className="flex items-center gap-4">
          <button type="button" disabled={pending} onClick={submit} className={buttonClass}>
            {pending ? "Saving…" : `Receive ${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
          </button>
          <span className="text-sm text-zinc-500">Delivery value {total.toFixed(2)} ETB</span>
        </div>
      )}
    </div>
  );
}

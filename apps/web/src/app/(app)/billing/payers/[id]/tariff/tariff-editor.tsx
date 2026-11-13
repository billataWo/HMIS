"use client";

import { useMemo, useState, useTransition } from "react";
import { savePayerTariff } from "@/app/actions";
import { Alert, buttonClass, inputClass, Notice } from "@/components/ui";
import type { PayerTariff } from "@/lib/api";
import { etb } from "@/lib/format";

const KIND: Record<string, string> = { SERVICE: "Services", LAB: "Lab tests", DRUG: "Drugs" };
type Row = PayerTariff["items"][number];

/**
 * The payer's price list: for each service, test and drug, the payer's own price (empty: the
 * clinic's) or "not covered" (the patient pays it all). Search to find items in a long drug list.
 */
export function TariffEditor({ tariff }: { tariff: PayerTariff }) {
  const [rows, setRows] = useState<Row[]>(tariff.items);
  const [q, setQ] = useState("");
  const [onlySet, setOnlySet] = useState(false);
  const [result, setResult] = useState<{ error?: string; saved?: number }>();
  const [pending, start] = useTransition();
  const set = (r: Row, patch: Partial<Row>) => setRows((all) => all.map((x) => (x.itemType === r.itemType && x.itemId === r.itemId ? { ...x, ...patch } : x)));
  const shown = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()) && (!onlySet || r.excluded || r.price !== null)),
    [rows, q, onlySet],
  );
  const changed = rows.filter((r) => r.excluded || r.price !== null).length;
  const save = () =>
    start(async () =>
      setResult(
        await savePayerTariff(
          tariff.payer.id,
          rows.filter((r) => r.excluded || r.price !== null).map((r) => ({ itemType: r.itemType, itemId: r.itemId, price: r.price === null ? null : Number(r.price), excluded: r.excluded })),
        ),
      ),
    );

  return (
    <div className="space-y-4">
      {result?.error && <Alert>{result.error}</Alert>}
      {result?.saved !== undefined && !pending && <Notice tone="success">Price list saved: {result.saved} items with their own price or not covered.</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service, test or drug" aria-label="Find" className={`${inputClass} w-64`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} /> Only items with their own terms ({changed})
        </label>
        <button type="button" disabled={pending} onClick={save} className={`${buttonClass} ml-auto`}>
          {pending ? "Saving…" : "Save price list"}
        </button>
      </div>
      {(["SERVICE", "LAB", "DRUG"] as const).map((kind) => {
        const list = shown.filter((r) => r.itemType === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="surface overflow-x-auto p-4 dark:border-slate-800">
            <h2 className="mb-2 font-semibold">{KIND[kind]}</h2>
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Item</th>
                  <th className="py-1 pr-3 text-right font-medium">Clinic price</th>
                  <th className="py-1 pr-3 font-medium">Their price</th>
                  <th className="py-1 font-medium">Not covered</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.itemId} className={`border-t border-slate-100 dark:border-slate-800 ${r.excluded ? "text-slate-400" : ""}`}>
                    <td className="py-1.5 pr-3">{r.name}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{etb(r.cashPrice)}</td>
                    <td className="py-1.5 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.price ?? ""}
                        disabled={r.excluded}
                        onChange={(e) => set(r, { price: e.target.value === "" ? null : e.target.value })}
                        placeholder="same"
                        aria-label={`${r.name}: their price`}
                        className={`${inputClass} w-28 py-1`}
                      />
                    </td>
                    <td className="py-1.5">
                      <input type="checkbox" checked={r.excluded} onChange={(e) => set(r, { excluded: e.target.checked })} aria-label={`${r.name}: not covered`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

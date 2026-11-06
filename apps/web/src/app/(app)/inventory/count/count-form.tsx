"use client";

import { Search } from "lucide-react";
import { useActionState, useState } from "react";
import { saveStockCount, type FormState } from "@/app/actions";
import { Alert, buttonClass, Input, inputClass, Notice } from "@/components/ui";
import { clinicToday } from "@/lib/format";

export interface CountBatch {
  id: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  costPrice: string;
  drug: { id: string; genericName: string; strength: string | null; form: string; unit: string };
}

/**
 * A count sheet: system quantity per batch beside an input for what was counted. Blank means "not
 * counted", so a count can be done one shelf at a time.
 */
export function CountForm({ batches }: { batches: CountBatch[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveStockCount, {});
  const [q, setQ] = useState("");
  const today = clinicToday();
  const shown = batches.filter((b) => `${b.drug.genericName} ${b.batchNo}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.values?.summary && !pending && <Notice tone="success">{state.values.summary}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by drug or batch" aria-label="Filter" className={`${inputClass} pl-9`} />
        </div>
        <Input name="note" placeholder="Note, e.g. monthly count, shelf A" aria-label="Note" className="max-w-xs" />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save count"}
        </button>
      </div>
      <div className="surface overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
            <tr>
              <th className="px-4 py-3">Drug</th>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Expiry</th>
              <th className="px-4 py-3 text-right">In the system</th>
              <th className="px-4 py-3">Counted</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              // Filtered rows stay in the form (hidden), so a typed count is not lost while filtering.
              <tr key={b.id} className={`border-t border-slate-100 dark:border-slate-800 ${shown.includes(b) ? "" : "hidden"}`}>
                <td className="px-4 py-2">
                  {b.drug.genericName} {b.drug.strength} {b.drug.form}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{b.batchNo}</td>
                <td className={`px-4 py-2 ${b.expiryDate.slice(0, 10) < today ? "font-medium text-red-700 dark:text-red-400" : ""}`}>{b.expiryDate.slice(0, 10)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {b.quantity} <span className="text-xs text-slate-500">{b.drug.unit}</span>
                </td>
                <td className="px-4 py-2">
                  <Input name={`count_${b.id}`} type="number" min={0} aria-label={`Counted ${b.drug.genericName} batch ${b.batchNo}`} className="w-28" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

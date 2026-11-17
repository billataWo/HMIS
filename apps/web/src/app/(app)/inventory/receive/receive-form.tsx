"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { receiveStock, searchDrugs } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, inputClass, secondaryButtonClass } from "@/components/ui";
import { etb } from "@/lib/format";
import type { DrugOption, Store, Supplier } from "@/lib/api";
import { packLabel } from "@/lib/packs";

/** `byPack`: quantity and cost are per pack (box of 100); stock is always received in units. */
type Line = { drug: DrugOption; batchNo: string; expiryDate: string; quantity: string; costPrice: string; byPack: boolean };

/** The line in units: packs × pack size, and the cost of one unit (to the cent). */
function toUnits(l: Line) {
  const per = l.byPack && l.drug.packSize ? l.drug.packSize : 1;
  return { quantity: Number(l.quantity || 0) * per, costPrice: Math.round((Number(l.costPrice || 0) / per) * 100) / 100 };
}

/** A purchase order's outstanding units, shown in packs when they come to whole packs. */
function fromOrder(l: { drug: DrugOption; outstanding: number; unitCost: string | null }): Line {
  const size = l.drug.packSize;
  const byPack = !!size && l.outstanding % size === 0;
  const per = byPack ? size! : 1;
  const cost = l.unitCost ? Number(l.unitCost) * per : null;
  return { drug: l.drug, batchNo: "", expiryDate: "", quantity: String(l.outstanding / per), costPrice: cost === null ? "" : String(Math.round(cost * 100) / 100), byPack };
}

/** With `order`, the delivery fills that purchase order: supplier and outstanding quantities are filled in. */
export function ReceiveForm({
  suppliers,
  stores = [],
  preset,
  minExpiry,
  order,
}: {
  suppliers: Supplier[];
  /** Several stores: where the delivery can go (empty: one store). */
  stores?: Store[];
  preset?: DrugOption;
  minExpiry: string;
  order?: { id: string; number: string; supplierId: string; lines: { drug: DrugOption; outstanding: number; unitCost: string | null }[] };
}) {
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? "");
  const [receiptRef, setReceiptRef] = useState("");
  // Deliveries go to the main store (the first that doesn't dispense) unless another is chosen.
  const [storeId, setStoreId] = useState(stores.find((s) => !s.dispensary)?.id ?? stores[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>(
    order
      ? order.lines.map(fromOrder)
      : preset
        ? [{ drug: preset, batchNo: "", expiryDate: "", quantity: "", costPrice: "", byPack: !!preset.packSize }]
        : [],
  );
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DrugOption[]>([]);
  const results = q.trim().length < 2 ? [] : found;
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ received: number; warnings: string[] }>();
  const [pending, start] = useTransition();
  const t = useT();

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await searchDrugs(q);
      if (!cancelled) setFound(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + toUnits(l).quantity * toUnits(l).costPrice, 0);

  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = await receiveStock({
        supplierId: supplierId || undefined,
        purchaseOrderId: order?.id,
        receiptRef: receiptRef || undefined,
        storeId: storeId || undefined,
        items: lines.map((l) => ({ drugId: l.drug.id, batchNo: l.batchNo, expiryDate: l.expiryDate, ...toUnits(l) })),
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
          {t(done.received === 1 ? "Received {n} line into stock." : "Received {n} lines into stock.", { n: done.received })}
        </p>
        {done.warnings.length > 0 && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p className="font-medium">{t("Check these prices:")}</p>
            <ul className="list-disc pl-5">
              {done.warnings.map((w) => (
                <li key={w}>{t(w)}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => setDone(undefined)} className={buttonClass}>
            {t("Receive another delivery")}
          </button>
          <Link href="/inventory" className={secondaryButtonClass}>
            {t("Back to inventory")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {order && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900 dark:bg-brand-950 dark:text-brand-100">
          {t.rich("Receiving against purchase order {number}. Quantities still outstanding are filled in; change them to what actually arrived.", { number: <strong>{order.number}</strong> })}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Supplier")}>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
            <option value="">{t("Not specified")}</option>
            {suppliers
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("Supplier invoice / delivery note no.")}>
          <input value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} className={inputClass} />
        </Field>
        {stores.length > 0 && (
          <Field label={t("Into store")} hint={t("The pharmacy dispenses only from stores marked (dispensary)")}>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputClass}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.dispensary ? ` (${t("dispensary")})` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {lines.length > 0 && (
        <div className="overflow-x-auto surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3 font-medium">{t("Drug")}</th>
                <th className="px-4 py-3 font-medium">{t("Batch no.")}</th>
                <th className="px-4 py-3 font-medium">{t("Expiry")}</th>
                <th className="px-4 py-3 font-medium">{t("Quantity")}</th>
                <th className="px-4 py-3 font-medium">{t("Cost")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-200 align-top dark:border-slate-800">
                  <td className="px-4 py-3">
                    <span className="font-medium">{l.drug.genericName}</span> {l.drug.strength}
                    <span className="block text-xs text-slate-500">
                      {t("sells at {price} / {unit}", { price: Number(l.drug.sellPrice).toFixed(2), unit: l.drug.unit })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <input value={l.batchNo} onChange={(e) => update(i, { batchNo: e.target.value })} aria-label={t("Batch number")} className={`${inputClass} w-28`} />
                  </td>
                  <td className="px-4 py-3">
                    <input type="date" min={minExpiry} value={l.expiryDate} onChange={(e) => update(i, { expiryDate: e.target.value })} aria-label={t("Expiry date")} className={`${inputClass} w-40`} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <input type="number" min={1} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} aria-label={t("Quantity")} className={`${inputClass} w-24`} />
                      {l.drug.packSize ? (
                        <select
                          value={l.byPack ? "pack" : "unit"}
                          onChange={(e) => update(i, { byPack: e.target.value === "pack" })}
                          aria-label={t("Count {drug} in", { drug: l.drug.genericName })}
                          className={`${inputClass} w-auto py-1.5 text-xs`}
                        >
                          <option value="pack">{packLabel(l.drug)}</option>
                          <option value="unit">{l.drug.unit}</option>
                        </select>
                      ) : null}
                    </div>
                    {l.byPack && Number(l.quantity) > 0 && (
                      <span className="mt-1 block text-xs text-slate-500">
                        = {toUnits(l).quantity} {l.drug.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.costPrice}
                      onChange={(e) => update(i, { costPrice: e.target.value })}
                      aria-label={t(l.byPack ? "Cost per pack" : "Cost per unit")}
                      className={`${inputClass} w-24 ${l.costPrice && toUnits(l).costPrice > Number(l.drug.sellPrice) ? "border-amber-500" : ""}`}
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      {t("per {unit}", { unit: l.byPack ? l.drug.packName || t("pack") : l.drug.unit })}
                      {l.byPack && l.costPrice && ` · ${t("{price} each", { price: toUnits(l).costPrice.toFixed(2) })}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-red-700 hover:underline dark:text-red-400">
                      {t("Remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Add a drug to this delivery…")} aria-label={t("Search drugs")} className={inputClass} />
        {results.length > 0 && (
          <ul className="max-h-60 overflow-y-auto rounded-md border border-slate-200 text-sm dark:border-slate-800">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setLines((ls) => [...ls, { drug: r, batchNo: "", expiryDate: "", quantity: "", costPrice: "", byPack: !!r.packSize }]);
                    setQ("");
                    setFound([]);
                  }}
                  className="flex w-full justify-between px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span>
                    {r.genericName} {r.strength} {r.form}
                  </span>
                  <span className="text-xs text-slate-500">{t("{n} in stock", { n: r.inStock })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && results.length === 0 && (
          <p className="text-xs text-slate-500">
            {t("Not in the drug list.")}{" "}
            <Link href="/inventory/drugs/new" className="text-brand-700 underline dark:text-brand-400">
              {t("Add it first")}
            </Link>
          </p>
        )}
      </div>

      {error && <Alert>{t(error)}</Alert>}
      {lines.length > 0 && (
        <div className="flex items-center gap-4">
          <button type="button" disabled={pending} onClick={submit} className={buttonClass}>
            {pending ? t("Saving…") : t(lines.length === 1 ? "Receive {n} line" : "Receive {n} lines", { n: lines.length })}
          </button>
          <span className="text-sm text-slate-500">{t("Delivery value {amount}", { amount: etb(total, t) })}</span>
        </div>
      )}
    </div>
  );
}

"use client";

import { Search, X } from "lucide-react";
import { useState, useTransition } from "react";
import { createTransfer } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, inputClass, Notice } from "@/components/ui";
import type { InventoryRow, Store } from "@/lib/api";
import { inPacks } from "@/lib/packs";

type Line = { drug: InventoryRow; quantity: string };

const label = (d: Pick<InventoryRow, "genericName" | "strength" | "form">) => [d.genericName, d.strength, d.form].filter(Boolean).join(" ");

/**
 * Moves stock from one store to another, usually the main store to the dispensary. Only drugs the
 * "from" store holds are offered, with how much it holds (usable, in date); the earliest-expiring
 * batches go first.
 */
export function TransferForm({ stores, drugs }: { stores: Store[]; drugs: InventoryRow[] }) {
  const active = stores.filter((s) => s.active);
  const [fromId, setFromId] = useState(active.find((s) => !s.dispensary)?.id ?? active[0]?.id ?? "");
  const [toId, setToId] = useState(active.find((s) => s.dispensary && s.id !== fromId)?.id ?? active.find((s) => s.id !== fromId)?.id ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();
  const t = useT();

  const held = (d: InventoryRow, storeId = fromId) => d.byStore?.find((b) => b.storeId === storeId)?.quantity ?? 0;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results =
    words.length && q.trim().length >= 2
      ? drugs.filter((d) => held(d) > 0 && !lines.some((l) => l.drug.id === d.id) && words.every((w) => label(d).toLowerCase().includes(w) || d.brandName?.toLowerCase().includes(w))).slice(0, 12)
      : [];

  const changeFrom = (id: string) => {
    setFromId(id);
    setLines([]);
    if (id === toId) setToId(active.find((s) => s.id !== id)?.id ?? "");
  };
  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = await createTransfer({
        fromStoreId: fromId,
        toStoreId: toId,
        note: note.trim() || undefined,
        items: lines.map((l) => ({ drugId: l.drug.id, quantity: Number(l.quantity) })),
      });
      if (res.error) setError(t(res.error));
      else {
        setDone(
          t(lines.length === 1 ? "{number}: {n} drug moved from {from} to {to}." : "{number}: {n} drugs moved from {from} to {to}.", {
            number: res.number ?? "",
            n: lines.length,
            from: active.find((s) => s.id === fromId)?.name,
            to: active.find((s) => s.id === toId)?.name,
          }),
        );
        setLines([]);
        setNote("");
      }
    });
  const bad = lines.some((l) => !(Number(l.quantity) >= 1) || Number(l.quantity) > held(l.drug) || !Number.isInteger(Number(l.quantity)));

  if (active.length < 2) return <p className="text-sm text-slate-500">{t("Add a second store below to move stock between stores.")}</p>;

  return (
    <div className="space-y-4">
      {done && <Notice tone="success">{done}</Notice>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("From store")}>
          <select value={fromId} onChange={(e) => changeFrom(e.target.value)} className={inputClass}>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("To store")}>
          <select value={toId} onChange={(e) => setToId(e.target.value)} className={inputClass}>
            {active
              .filter((s) => s.id !== fromId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.dispensary ? ` (${t("dispensary")})` : ""}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("Note (optional)")}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. weekly top-up")} className={inputClass} />
        </Field>
      </div>

      {lines.length > 0 && (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-xs text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-2 font-medium">{t("Drug")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("In {store}", { store: active.find((s) => s.id === fromId)?.name })}</th>
                <th className="px-4 py-2 text-right font-medium">{t("In {store}", { store: active.find((s) => s.id === toId)?.name })}</th>
                <th className="px-4 py-2 font-medium">{t("Move")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const over = Number(l.quantity) > held(l.drug);
                return (
                  <tr key={l.drug.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-4 py-2">{label(l.drug)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {held(l.drug)} {l.drug.unit}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{held(l.drug, toId)}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        max={held(l.drug)}
                        value={l.quantity}
                        onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                        aria-label={t("Units of {drug} to move", { drug: l.drug.genericName })}
                        aria-invalid={over}
                        className={`${inputClass} w-28 ${over ? "border-red-400!" : ""}`}
                      />
                      <span className="mt-1 block text-xs text-slate-500">{over ? t("Only {n} there", { n: held(l.drug) }) : (inPacks(Number(l.quantity) || 0, l.drug) ?? l.drug.unit)}</span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={t("Remove {drug}", { drug: l.drug.genericName })} className="rounded p-1 text-slate-500 hover:text-red-700">
                        <X aria-hidden className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="relative max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Add a drug held in {store}…", { store: active.find((s) => s.id === fromId)?.name ?? t("this store") })} aria-label={t("Add a drug to move")} className={`${inputClass} pl-9`} />
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-raised dark:border-slate-700 dark:bg-slate-900">
            {results.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setLines((ls) => [...ls, { drug: d, quantity: "" }]);
                    setQ("");
                  }}
                  className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span>{label(d)}</span>
                  <span className="text-xs text-slate-500">
                    {held(d)} {d.unit}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && results.length === 0 && <p className="mt-1 text-xs text-slate-500">{t("No drug with usable stock in this store matches.")}</p>}
      </div>

      {error && <Alert>{t(error)}</Alert>}
      {lines.length > 0 && (
        <button type="button" disabled={pending || bad || !toId} onClick={submit} className={buttonClass}>
          {pending ? t("Moving…") : t(lines.length === 1 ? "Move {n} drug" : "Move {n} drugs", { n: lines.length })}
        </button>
      )}
    </div>
  );
}

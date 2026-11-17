"use client";

import { useState, useTransition } from "react";
import { saveStore } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, Badge, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { Store } from "@/lib/api";

/** The clinic's stores: add one, rename, choose which dispense, close an empty one. */
export function StoresPanel({ stores }: { stores: Store[] }) {
  const [name, setName] = useState("");
  const [dispensary, setDispensary] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [rename, setRename] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const t = useT();
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      setError(undefined);
      const res = await fn();
      if (res.error) setError(res.error);
      else after?.();
    });

  return (
    <div className="space-y-3">
      {error && <Alert>{t(error)}</Alert>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
        {stores.map((s) => (
          <li key={s.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${s.active ? "" : "opacity-60"}`}>
            {editing === s.id ? (
              <span className="flex flex-wrap items-center gap-2">
                <input value={rename} onChange={(e) => setRename(e.target.value)} aria-label={t("New name for {store}", { store: s.name })} className={`${inputClass} w-48 py-1.5`} />
                <button type="button" disabled={pending || rename.trim().length < 2} onClick={() => run(() => saveStore(s.id, { name: rename.trim() }), () => setEditing(undefined))} className={`${buttonClass} px-3 py-1.5 text-xs`}>
                  {t("Save")}
                </button>
                <button type="button" onClick={() => setEditing(undefined)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
                  {t("Cancel")}
                </button>
              </span>
            ) : (
              <span>
                <span className="font-medium">{s.name}</span>{" "}
                {s.dispensary && <Badge tone="brand">{t("Dispenses")}</Badge>} {!s.active && <Badge>{t("Closed")}</Badge>}
                <span className="block text-xs text-slate-500">
                  {t(s.drugs === 1 ? "{units} units of {n} drug in date" : "{units} units of {n} drugs in date", { units: s.units, n: s.drugs })}
                </span>
              </span>
            )}
            {editing !== s.id && (
              <span className="flex flex-wrap gap-3 text-xs">
                <button type="button" onClick={() => (setEditing(s.id), setRename(s.name))} className="text-brand-700 hover:underline dark:text-brand-400">
                  {t("Rename")}
                </button>
                {s.active && (
                  <button type="button" disabled={pending} onClick={() => run(() => saveStore(s.id, { dispensary: !s.dispensary }))} className="text-brand-700 hover:underline dark:text-brand-400">
                    {t(s.dispensary ? "Stop dispensing from it" : "Dispense from it")}
                  </button>
                )}
                <button type="button" disabled={pending} onClick={() => run(() => saveStore(s.id, { active: !s.active }))} className={s.active ? "text-red-700 hover:underline dark:text-red-400" : "text-brand-700 hover:underline dark:text-brand-400"}>
                  {t(s.active ? "Close" : "Reopen")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("New store, e.g. Ward 1")} aria-label={t("New store name")} className={`${inputClass} w-56`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dispensary} onChange={(e) => setDispensary(e.target.checked)} /> {t("Dispenses to patients")}
        </label>
        <button
          type="button"
          disabled={pending || name.trim().length < 2}
          onClick={() => run(() => saveStore(null, { name: name.trim(), dispensary }), () => (setName(""), setDispensary(false)))}
          className={secondaryButtonClass}
        >
          {t("Add store")}
        </button>
      </div>
    </div>
  );
}

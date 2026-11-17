"use client";

import { Repeat } from "lucide-react";
import { useState, useTransition } from "react";
import { drugEquivalents, substituteDrug } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { etb } from "@/lib/format";
import type { DrugOption } from "@/lib/api";

const name = (d: Pick<DrugOption, "genericName" | "strength" | "form" | "brandName">) =>
  `${[d.genericName, d.strength, d.form].filter(Boolean).join(" ")}${d.brandName ? ` (${d.brandName})` : ""}`;

/**
 * Another brand of the same drug, strength and form instead of the one prescribed: for when the
 * prescribed brand is out of stock (or the patient asks for a cheaper one). Not a <form>: it sits
 * inside the dispensing form.
 */
export function Substitute({ itemId, need }: { itemId: string; need: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<DrugOption[]>();
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState(() => t("Prescribed brand out of stock"));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const show = () =>
    start(async () => {
      setOpen(true);
      setError(undefined);
      const list = await drugEquivalents(itemId);
      setOptions(list);
      setChoice(list.find((d) => d.inStock >= need)?.id ?? list[0]?.id ?? "");
    });
  const swap = () =>
    start(async () => {
      const res = await substituteDrug(itemId, choice, reason);
      if (res.error) setError(res.error);
      else setOpen(false);
    });

  if (!open) {
    return (
      <button type="button" onClick={show} disabled={pending} className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline dark:text-brand-400">
        <Repeat aria-hidden className="size-3" />
        {t("Give another brand")}
      </button>
    );
  }
  return (
    <div className="mt-2 w-72 max-w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/40">
      {!options ? (
        <p className="text-slate-500">{t("Looking for other brands…")}</p>
      ) : options.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-300">
          {t("No other brand of this drug, strength and form is in the list. For a different drug, ask the doctor to change the prescription.")}
        </p>
      ) : (
        <>
          <fieldset className="space-y-1">
            <legend className="mb-1 font-medium text-slate-700 dark:text-slate-200">{t("Give instead")}</legend>
            {options.map((d) => (
              <label key={d.id} className={`flex items-start gap-2 ${d.inStock < need ? "text-slate-500" : ""}`}>
                <input type="radio" name={`swap_${itemId}`} checked={choice === d.id} onChange={() => setChoice(d.id)} className="mt-0.5" />
                <span>
                  {name(d)}
                  <span className="block text-slate-500">
                    {t("{n} in stock", { n: d.inStock })} · {etb(d.sellPrice, t)} / {d.unit}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Reason for giving another brand")} className={`${inputClass} py-1.5 text-xs`} />
        </>
      )}
      {error && <Alert>{t(error)}</Alert>}
      <div className="flex gap-2">
        {!!options?.length && (
          <button type="button" disabled={pending || !choice || reason.trim().length < 3} onClick={swap} className={`${buttonClass} px-3 py-1.5 text-xs`}>
            {pending ? t("Saving…") : t("Give this instead")}
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

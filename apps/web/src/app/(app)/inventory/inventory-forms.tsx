"use client";

import { useActionState, useState } from "react";
import { adjustStock, saveDrug, saveSupplier, type FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, inputClass } from "@/components/ui";
import type { DrugStock, Supplier } from "@/lib/api";

export const FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "vial", "inhaler", "cream", "ointment", "drops", "sachet", "suppository", "other"];

export function DrugForm({ drug }: { drug?: DrugStock["drug"] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDrug, {});
  const v = state.error ? (state.values ?? {}) : {};
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  const val = (k: keyof DrugStock["drug"]) => v[k] ?? (drug?.[k] === null || drug?.[k] === undefined ? "" : String(drug[k]));

  return (
    <form action={action} className="space-y-4">
      {drug && <input type="hidden" name="id" value={drug.id} />}
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Saved.")}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Generic name *")} error={err.genericName}>
          <Input name="genericName" required defaultValue={val("genericName")} />
        </Field>
        <Field label={t("Brand name")} error={err.brandName}>
          <Input name="brandName" defaultValue={val("brandName")} />
        </Field>
        <Field label={t("Drug class")} hint={t("Used for allergy and interaction checks, e.g. penicillin, nsaid")} error={err.drugClass}>
          <Input name="drugClass" defaultValue={val("drugClass")} />
        </Field>
        <Field label={t("Strength")} error={err.strength}>
          <Input name="strength" placeholder="500 mg" defaultValue={val("strength")} />
        </Field>
        <Field label={t("Form *")} error={err.form}>
          <select name="form" required defaultValue={val("form") || "tablet"} className={inputClass}>
            {FORMS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Dispensing unit *")} hint={t("What one unit of quantity means: tablet, bottle, vial…")} error={err.unit}>
          <Input name="unit" required defaultValue={val("unit") || "tablet"} />
        </Field>
        <Field label={t("Selling price per unit (ETB) *")} error={err.sellPrice}>
          <Input name="sellPrice" type="number" min={0} step="0.01" required defaultValue={val("sellPrice")} />
        </Field>
        <Field label={t("Reorder level")} hint={t("Flag as low stock at or below this quantity (in units)")} error={err.reorderLevel}>
          <Input name="reorderLevel" type="number" min={0} defaultValue={val("reorderLevel") || "0"} />
        </Field>
        <Field label={t("Bought in")} hint={t("What the supplier sells: box, strip, bottle… Leave empty if bought by the unit")} error={err.packName}>
          <Input name="packName" placeholder="box" defaultValue={val("packName")} />
        </Field>
        <Field label={t("Controlled drug")} hint={t("Narcotics and psychotropics are kept in the controlled-drug register and never sold over the counter")} error={err.controlled}>
          <select name="controlled" defaultValue={val("controlled")} className={inputClass}>
            <option value="">{t("No")}</option>
            <option value="NARCOTIC">{t("Narcotic (e.g. tramadol, pethidine, morphine)")}</option>
            <option value="PSYCHOTROPIC">{t("Psychotropic (e.g. diazepam, phenobarbital)")}</option>
          </select>
        </Field>
        <Field label={t("Units per pack")} hint={t("e.g. 100 tablets in a box. Lets you receive and order by the pack")} error={err.packSize}>
          <Input name="packSize" type="number" min={2} placeholder="100" defaultValue={val("packSize")} />
        </Field>
      </div>
      {drug && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={drug.active} /> {t("Active (can be prescribed)")}
        </label>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? t("Saving…") : drug ? t("Save changes") : t("Add drug")}
      </button>
    </form>
  );
}

const REASONS: [string, string][] = [
  ["DAMAGED", "Damaged"],
  ["LOST", "Lost / missing"],
  ["RETURNED_TO_SUPPLIER", "Returned to supplier"],
  ["COUNT_CORRECTION", "Count correction"],
  ["OTHER", "Other"],
];

export function AdjustForm({ batches, unit }: { batches: DrugStock["batches"]; unit: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(adjustStock, {});
  const [reason, setReason] = useState("DAMAGED");
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  const live = batches.filter((b) => b.quantity > 0 || !b.expired);
  if (!live.length) return <p className="text-sm text-slate-500">{t("No batches to adjust.")}</p>;

  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{t(state.error)}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Adjustment recorded.")}</p>}
      <Field label={t("Batch")}>
        <select name="batchId" required className={inputClass}>
          {live.map((b) => (
            <option key={b.id} value={b.id}>
              {b.batchNo} · {b.quantity} {unit} · {t("exp {date}", { date: b.expiryDate.slice(0, 10) })}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Reason")}>
          <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
            {REASONS.map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Quantity")} error={err.quantity}>
          <div className="flex gap-2">
            {reason === "COUNT_CORRECTION" ? (
              <select name="direction" className={`${inputClass} w-20`} aria-label={t("Add or remove")}>
                <option value="remove">−</option>
                <option value="add">+</option>
              </select>
            ) : (
              <input type="hidden" name="direction" value="remove" />
            )}
            <Input name="quantity" type="number" min={1} required />
          </div>
        </Field>
      </div>
      <Field label={t(reason === "OTHER" ? "Note *" : "Note")} error={err.note}>
        <Input name="note" required={reason === "OTHER"} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? t("Saving…") : t("Record adjustment")}
      </button>
    </form>
  );
}

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSupplier, {});
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  const v = state.error ? (state.values ?? {}) : {};
  return (
    <form action={action} className="space-y-3">
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      {state.error && <Alert>{t(state.error)}</Alert>}
      <Field label={t("Name *")} error={err.name}>
        <Input name="name" required defaultValue={v.name ?? supplier?.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Phone")} error={err.phone}>
          <Input name="phone" type="tel" defaultValue={v.phone ?? supplier?.phone ?? ""} />
        </Field>
        <Field label="TIN" error={err.tin}>
          <Input name="tin" defaultValue={v.tin ?? supplier?.tin ?? ""} />
        </Field>
      </div>
      <Field label={t("Contact person")} error={err.contactPerson}>
        <Input name="contactPerson" defaultValue={v.contactPerson ?? supplier?.contactPerson ?? ""} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? t("Saving…") : supplier ? t("Save") : t("Add supplier")}
      </button>
    </form>
  );
}

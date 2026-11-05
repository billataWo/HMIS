"use client";

import { useActionState, useState } from "react";
import { adjustStock, saveDrug, saveSupplier, type FormState } from "@/app/actions";
import { Alert, buttonClass, Field, Input, inputClass } from "@/components/ui";
import type { DrugStock, Supplier } from "@/lib/api";

const FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "vial", "inhaler", "cream", "ointment", "drops", "sachet", "suppository", "other"];

export function DrugForm({ drug }: { drug?: DrugStock["drug"] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDrug, {});
  const v = state.error ? (state.values ?? {}) : {};
  const err = state.fieldErrors ?? {};
  const val = (k: keyof DrugStock["drug"]) => v[k] ?? (drug?.[k] === null || drug?.[k] === undefined ? "" : String(drug[k]));

  return (
    <form action={action} className="space-y-4">
      {drug && <input type="hidden" name="id" value={drug.id} />}
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Generic name *" error={err.genericName}>
          <Input name="genericName" required defaultValue={val("genericName")} />
        </Field>
        <Field label="Brand name" error={err.brandName}>
          <Input name="brandName" defaultValue={val("brandName")} />
        </Field>
        <Field label="Drug class" hint="Used for allergy and interaction checks, e.g. penicillin, nsaid" error={err.drugClass}>
          <Input name="drugClass" defaultValue={val("drugClass")} />
        </Field>
        <Field label="Strength" error={err.strength}>
          <Input name="strength" placeholder="500 mg" defaultValue={val("strength")} />
        </Field>
        <Field label="Form *" error={err.form}>
          <select name="form" required defaultValue={val("form") || "tablet"} className={inputClass}>
            {FORMS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        <Field label="Dispensing unit *" hint="What one unit of quantity means: tablet, bottle, vial…" error={err.unit}>
          <Input name="unit" required defaultValue={val("unit") || "tablet"} />
        </Field>
        <Field label="Selling price per unit (ETB) *" error={err.sellPrice}>
          <Input name="sellPrice" type="number" min={0} step="0.01" required defaultValue={val("sellPrice")} />
        </Field>
        <Field label="Reorder level" hint="Flag as low stock at or below this quantity" error={err.reorderLevel}>
          <Input name="reorderLevel" type="number" min={0} defaultValue={val("reorderLevel") || "0"} />
        </Field>
      </div>
      {drug && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={drug.active} /> Active (can be prescribed)
        </label>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : drug ? "Save changes" : "Add drug"}
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
  const err = state.fieldErrors ?? {};
  const live = batches.filter((b) => b.quantity > 0 || !b.expired);
  if (!live.length) return <p className="text-sm text-zinc-500">No batches to adjust.</p>;

  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">Adjustment recorded.</p>}
      <Field label="Batch">
        <select name="batchId" required className={inputClass}>
          {live.map((b) => (
            <option key={b.id} value={b.id}>
              {b.batchNo} · {b.quantity} {unit} · exp {b.expiryDate.slice(0, 10)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reason">
          <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
            {REASONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" error={err.quantity}>
          <div className="flex gap-2">
            {reason === "COUNT_CORRECTION" ? (
              <select name="direction" className={`${inputClass} w-20`} aria-label="Add or remove">
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
      <Field label={reason === "OTHER" ? "Note *" : "Note"} error={err.note}>
        <Input name="note" required={reason === "OTHER"} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Record adjustment"}
      </button>
    </form>
  );
}

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSupplier, {});
  const err = state.fieldErrors ?? {};
  const v = state.error ? (state.values ?? {}) : {};
  return (
    <form action={action} className="space-y-3">
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Name *" error={err.name}>
        <Input name="name" required defaultValue={v.name ?? supplier?.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" error={err.phone}>
          <Input name="phone" type="tel" defaultValue={v.phone ?? supplier?.phone ?? ""} />
        </Field>
        <Field label="TIN" error={err.tin}>
          <Input name="tin" defaultValue={v.tin ?? supplier?.tin ?? ""} />
        </Field>
      </div>
      <Field label="Contact person" error={err.contactPerson}>
        <Input name="contactPerson" defaultValue={v.contactPerson ?? supplier?.contactPerson ?? ""} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : supplier ? "Save" : "Add supplier"}
      </button>
    </form>
  );
}

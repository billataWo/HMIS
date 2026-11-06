"use client";

import { Pencil } from "lucide-react";
import { useActionState, useState } from "react";
import { saveAllergies, type FormState } from "@/app/actions";
import { Alert, buttonClass, Input, secondaryButtonClass } from "./ui";

/**
 * Lets doctors and nurses record an allergy found during a visit. Saved allergies take effect in
 * the prescribing checks immediately.
 */
export function AllergyEditor({ patientId, allergies }: { patientId: string; allergies: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveAllergies, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">
        <Pencil aria-hidden className="size-3" />
        {allergies.length ? "Update allergies" : "Record an allergy"}
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <input type="hidden" name="patientId" value={patientId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && <p className="text-xs text-emerald-700 dark:text-emerald-400">Saved. Prescriptions are now checked against these.</p>}
      <label className="block text-sm font-medium">
        Allergies
        <Input name="allergies" defaultValue={state.values?.allergies ?? allergies.join(", ")} placeholder="e.g. Penicillin, Sulfa" className="mt-1" />
      </label>
      <p className="text-xs text-slate-500">Separate with commas. Clear the box if the patient has none.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
          {pending ? "Saving…" : "Save allergies"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
          Close
        </button>
      </div>
    </form>
  );
}

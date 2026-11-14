"use client";

import { useActionState } from "react";
import { mergePatient, type FormState } from "@/app/actions";
import { Alert, dangerButtonClass } from "@/components/ui";

/** The last step of a merge: a tick that these are the same person, then the merge. */
export function MergeForm({ keeperId, duplicateId, label }: { keeperId: string; duplicateId: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mergePatient.bind(null, keeperId, duplicateId), {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="sure" required className="mt-0.5" />
        <span>I have checked these are the same person (name, age, phone, family). Merging cannot be undone.</span>
      </label>
      <button disabled={pending} className={dangerButtonClass}>
        {pending ? "Merging…" : label}
      </button>
    </form>
  );
}

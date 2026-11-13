"use client";

import { useActionState, useState } from "react";
import { followUpReferral, type FormState } from "@/app/actions";
import { Alert, buttonClass, inputClass } from "@/components/ui";

const OPTIONS = [
  { value: "ARRIVED", label: "Patient arrived there" },
  { value: "FEEDBACK_RECEIVED", label: "Feedback received" },
  { value: "DID_NOT_GO", label: "Patient did not go" },
  { value: "SENT", label: "Note only (e.g. phoned the patient)" },
];

/** Records what became of a referral; the note is needed for feedback and for a plain note. */
export function FollowUpForm({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(followUpReferral, {});
  const [status, setStatus] = useState("ARRIVED");
  const noteNeeded = status === "FEEDBACK_RECEIVED" || status === "SENT";
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="documentId" value={documentId} />
      {state.error && <Alert>{state.error}</Alert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="What happened" className={`${inputClass} sm:w-60`}>
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          name="note"
          required={noteNeeded}
          minLength={noteNeeded ? 3 : undefined}
          placeholder={status === "FEEDBACK_RECEIVED" ? "What they found and did" : noteNeeded ? "What was done" : "Note (optional)"}
          aria-label="Note"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button disabled={pending} className={`${buttonClass} shrink-0 px-3 py-1.5 text-xs`}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

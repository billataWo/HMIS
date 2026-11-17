"use client";

import { useActionState } from "react";
import { traceMissed, type FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, inputClass } from "@/components/ui";
import { TRACE_OUTCOMES } from "@/lib/appointment-follow-up";

/** What came of the call after a missed appointment. */
export function TraceForm({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(traceMissed, {});
  const t = useT();
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select name="outcome" required defaultValue="" aria-label={t("Outcome of the call")} className={`${inputClass} sm:w-44`}>
          <option value="" disabled>
            {t("The call…")}
          </option>
          {TRACE_OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
        <input name="note" maxLength={500} placeholder={t("Note (optional)")} aria-label={t("Note")} className={`${inputClass} min-w-0 flex-1`} />
        <button disabled={pending} className={`${buttonClass} shrink-0 px-3 py-1.5 text-xs`}>
          {pending ? t("Saving…") : t("Save")}
        </button>
      </div>
    </form>
  );
}

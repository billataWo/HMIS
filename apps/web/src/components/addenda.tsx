"use client";

import { useActionState } from "react";
import { addAddendum, type FormState } from "@/app/actions";
import type { VisitAddendum } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";
import { Alert, buttonClass, inputClass } from "./ui";

/**
 * Notes added to a visit afterwards: a result reviewed, a phone call, something remembered. Each is
 * signed and timed and never edited, so the original record stays as it was; they can be added
 * after the visit is closed.
 */
export function Addenda({ visitId, addenda, canAdd }: { visitId: string; addenda: VisitAddendum[]; canAdd: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addAddendum, {});
  if (!addenda.length && !canAdd) return null;
  return (
    <section id="addenda" className="surface scroll-mt-6 space-y-3 p-5 dark:border-slate-800">
      <h2 className="font-semibold text-slate-900 dark:text-white">Addenda</h2>
      {addenda.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing added after the consultation.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {addenda.map((a) => (
            <li key={a.id} className="rounded-md border-l-2 border-brand-500 bg-slate-50 px-3 py-2 dark:bg-slate-900">
              <p className="whitespace-pre-wrap">{a.text}</p>
              <p className="mt-1 text-xs text-slate-500">
                {a.author?.fullName ?? "Unknown"} · {formatDualDate(a.createdAt)} {formatTime(a.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form key={addenda.length} action={action} className="space-y-2">
          <input type="hidden" name="visitId" value={visitId} />
          {state.error && <Alert>{state.error}</Alert>}
          <textarea
            name="text"
            required
            minLength={3}
            rows={2}
            placeholder="Add a note to this visit (it is signed and timed, and can't be changed later)"
            aria-label="Addendum"
            className={inputClass}
          />
          <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
            {pending ? "Adding…" : "Add addendum"}
          </button>
        </form>
      )}
    </section>
  );
}

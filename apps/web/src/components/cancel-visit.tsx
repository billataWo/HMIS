"use client";

import { useEffect, useRef, useState } from "react";
import { CANCEL_REASONS } from "@/lib/cancel-reasons";

const quiet = "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";

/**
 * Cancelling a waiting visit, in place like the other cancels, but asking why: the reason goes on
 * the visit and the dashboard counts patients who left without being seen.
 */
export function CancelVisit({
  action,
  label = "Cancel",
  question = "Cancel this visit?",
  yes = "Yes, cancel",
  no = "Keep",
  reasons = CANCEL_REASONS.map((r) => ({ ...r })),
}: {
  action: (form: FormData) => void | Promise<void>;
  label?: string;
  question?: string;
  yes?: string;
  no?: string;
  reasons?: { value: string; label: string }[];
}) {
  const [asking, setAsking] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (asking) select.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={`${quiet} text-red-700 hover:bg-red-50 focus-visible:outline-red-600 dark:text-red-300 dark:hover:bg-red-950/50`}>
        {label}
      </button>
    );
  }
  return (
    <form
      action={action}
      onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
      role="group"
      aria-label={question}
      className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-red-50 py-1 pr-1 pl-3 text-xs dark:bg-red-950/50"
    >
      <span className="font-medium text-red-800 dark:text-red-200">{question}</span>
      <select ref={select} name="reason" required defaultValue="" aria-label="Reason" className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs dark:border-red-900 dark:bg-slate-900">
        <option value="" disabled>
          Why?
        </option>
        {reasons.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button type="submit" className={`${quiet} bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600`}>
        {yes}
      </button>
      <button type="button" onClick={() => setAsking(false)} className={`${quiet} text-slate-700 hover:bg-white focus-visible:outline-brand-600 dark:text-slate-200 dark:hover:bg-slate-800`}>
        {no}
      </button>
    </form>
  );
}

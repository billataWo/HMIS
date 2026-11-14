"use client";

import { useState } from "react";
import type { Doctor } from "@/lib/api";

const quiet = "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

/** Moves a waiting patient to another doctor, or to whoever is free. */
export function TransferDoctor({
  action,
  doctors,
  currentId,
  label = "Change doctor",
  move = "Move",
  keep = "Keep",
}: {
  action: (form: FormData) => void | Promise<void>;
  doctors: Doctor[];
  currentId: string | null;
  label?: string;
  move?: string;
  keep?: string;
}) {
  const [open, setOpen] = useState(false);
  const others = doctors.filter((d) => d.id !== currentId);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${quiet} text-slate-700 hover:bg-slate-100 focus-visible:outline-brand-600 dark:text-slate-200 dark:hover:bg-slate-800`}>
        {label}
      </button>
    );
  }
  return (
    <form
      action={action}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-slate-100 py-1 pr-1 pl-2 text-xs dark:bg-slate-800"
    >
      <select name="doctorId" defaultValue={others[0]?.id ?? ""} aria-label="Doctor" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
        {others.map((d) => (
          <option key={d.id} value={d.id}>
            Dr. {d.fullName}
            {d.room ? ` · ${d.room}` : ""}
          </option>
        ))}
        {currentId && <option value="">Any free doctor</option>}
      </select>
      <button type="submit" className={`${quiet} bg-brand-700 text-white hover:bg-brand-800 focus-visible:outline-brand-600`}>
        {move}
      </button>
      <button type="button" onClick={() => setOpen(false)} className={`${quiet} text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-900`}>
        {keep}
      </button>
    </form>
  );
}

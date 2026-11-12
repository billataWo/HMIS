import type { ReactNode } from "react";

/**
 * An on/off switch for a setting. A real checkbox underneath (role "switch"), so it submits with
 * its form, works with the keyboard (Space) and screen readers announce it as on or off.
 */
export function Toggle({ name, defaultChecked, label, children }: { name: string; defaultChecked?: boolean; label: string; children?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 text-sm">
      <span>
        <span className="font-medium text-slate-900 dark:text-white">{label}</span>
        {children && <span className="mt-0.5 block text-slate-500">{children}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
        <span
          aria-hidden
          className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 dark:bg-slate-600 dark:peer-checked:bg-brand-500 dark:peer-focus-visible:ring-offset-slate-900"
        />
        <span aria-hidden className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

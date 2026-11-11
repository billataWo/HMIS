import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/*
 * Shared building blocks. Default input width and button size come from the `control` and
 * `btn-size` classes (globals.css, components layer), so size utilities appended by a page win.
 */

export const inputClass =
  "control rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 aria-invalid:border-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus:border-brand-400 dark:focus:ring-brand-400/20";

const buttonBase =
  "btn-size inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0";

export const buttonClass = `${buttonBase} bg-brand-700 text-white shadow-sm shadow-brand-900/10 hover:bg-brand-800 dark:bg-brand-700 dark:hover:bg-brand-800`;

export const secondaryButtonClass = `${buttonBase} border border-slate-300 bg-white text-slate-700 shadow-xs hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800`;

export const dangerButtonClass = `${buttonBase} bg-red-600 text-white shadow-sm hover:bg-red-700`;

/** A destructive action's first step (it opens a confirmation): red, but not the loudest button. */
export const dangerQuietButtonClass = `${buttonBase} border border-red-300 bg-white text-red-700 shadow-xs hover:border-red-400 hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/50`;

export const ghostButtonClass = `${buttonBase} text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white`;

/** Segmented filter chips (date presets, doctor filter). */
export function pillClass(on: boolean) {
  return `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
    on
      ? "bg-brand-700 text-white shadow-sm dark:bg-brand-700"
      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
  }`;
}

export const linkClass = "font-medium text-brand-700 underline-offset-4 hover:underline dark:text-brand-400";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {children}
      {error ? (
        <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
          <CircleAlert aria-hidden className="size-3.5" />
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

type Tone = "danger" | "success" | "info" | "warning";

const NOTICE: Record<Tone, { icon: LucideIcon; className: string }> = {
  danger: {
    icon: CircleAlert,
    className: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200",
  },
  success: {
    icon: CircleCheck,
    className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-100",
  },
  info: {
    icon: Info,
    className: "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/50 dark:text-brand-100",
  },
  warning: {
    icon: TriangleAlert,
    className: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100",
  },
};

export function Notice({ tone = "info", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  const { icon: Icon, className: toneClass } = NOTICE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${toneClass} ${className}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return <Notice tone="danger">{children}</Notice>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  title,
  description,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            {title && <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export const BADGE_TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
  brand: "bg-brand-50 text-brand-800 ring-brand-600/20 dark:bg-brand-950 dark:text-brand-200 dark:ring-brand-400/25",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-400/25",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-400/25",
  danger: "bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-950 dark:text-red-200 dark:ring-red-400/25",
  info: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-400/25",
  violet: "bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-400/25",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export const badgeClass = "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset";

export function Badge({ tone = "neutral", dot, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`${badgeClass} ${BADGE_TONES[tone]}`}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/40">
      {Icon && (
        <span className="mb-3 grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <Icon aria-hidden className="size-5" />
        </span>
      )}
      <p className="font-medium text-slate-900 dark:text-white">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {Icon && <Icon aria-hidden className="size-4 text-slate-400" />}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div aria-hidden className={`shimmer rounded-xl ${className}`} />;
}

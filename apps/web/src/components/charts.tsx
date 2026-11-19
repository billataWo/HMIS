import { EN } from "@/lib/format";
import type { T } from "@/lib/i18n";

/**
 * Small dependency-free charts. One series per chart, one hue (teal), thin marks with rounded
 * data ends anchored to the baseline, a hover tooltip on every mark, and a table view, so values
 * are never available by colour or hover alone.
 */

export interface Point {
  label: string; // shown on the axis and in the tooltip
  value: number;
  display: string; // formatted value
}

/** Vertical bars over time. Labels the first, last and a few in-between days. */
export function ColumnChart({
  title,
  points,
  unit,
  t = EN,
  tick = (label) => label.slice(5),
  ariaLabel,
}: {
  title: string;
  points: Point[];
  unit?: string;
  t?: T;
  /** The axis text for a label (default: a YYYY-MM-DD day without its year). */
  tick?: (label: string) => string;
  /** What the chart shows, for screen readers (default: "{title}, {n} days"). */
  ariaLabel?: string;
}) {
  const max = Math.max(...points.map((p) => p.value), 0);
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-slate-500">{t("peak {value}", { value: points.find((p) => p.value === max)?.display ?? "0" })}</span>
      </figcaption>
      <div className="flex h-40 items-end gap-[2px] border-b border-slate-300 dark:border-slate-700" role="img" aria-label={ariaLabel ?? t("{title}, {n} days", { title, n: points.length })}>
        {points.map((p, i) => (
          <div key={p.label} className="group relative flex h-full min-w-[3px] flex-1 items-end justify-center">
            <div
              className="w-full max-w-6 origin-bottom animate-grow-y rounded-t-[4px] bg-brand-700 transition-opacity group-hover:opacity-80 dark:bg-brand-500"
              style={{
                height: max ? `${Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0)}%` : 0,
                animationDelay: `${Math.min(i * 12, 360)}ms`,
              }}
            />
            <span className="pointer-events-none absolute bottom-full z-10 mb-1.5 hidden rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-raised group-hover:block dark:bg-slate-100 dark:text-slate-900">
              {p.label}: {p.display}
              {unit && ` ${unit}`}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] text-[10px] text-slate-500">
        {points.map((p, i) => (
          <span key={p.label} className="min-w-[3px] flex-1 text-center">
            {i === 0 || i === points.length - 1 || i % every === 0 ? tick(p.label) : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Ranked horizontal bars with the value written beside each bar. */
export function BarList({ items }: { items: { key: string; label: React.ReactNode; value: number; display: string }[] }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul className="space-y-3 text-sm">
      {items.map((i, n) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
          <span className="truncate">{i.label}</span>
          <span className="text-right tabular-nums text-slate-600 dark:text-slate-400">{i.display}</span>
          <span className="col-span-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
            <span
              className="block h-full origin-left animate-grow-x rounded-full bg-brand-700 dark:bg-brand-500"
              style={{ width: max ? `${(i.value / max) * 100}%` : 0, animationDelay: `${Math.min(n * 40, 400)}ms` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

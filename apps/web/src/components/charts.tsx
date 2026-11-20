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

/**
 * Ranked horizontal bars with the value written beside each bar. `share` adds each item's part of
 * the whole ("42%") after the value, for a mix such as payments by method.
 */
export function BarList({ items, share = false }: { items: { key: string; label: React.ReactNode; value: number; display: string }[]; share?: boolean }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <ul className="space-y-3 text-sm">
      {items.map((i, n) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
          <span className="truncate">{i.label}</span>
          <span className="text-right tabular-nums text-slate-600 dark:text-slate-400">
            {i.display}
            {share && total > 0 && <span className="ml-2 inline-block w-10 text-xs text-slate-500">{Math.round((i.value / total) * 100)}%</span>}
          </span>
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

/** An axis top that reads well (1, 2, 2.5 or 5 × 10ⁿ per step, four steps); whole steps for counts. */
export function niceScale(max: number, whole = false) {
  const raw = Math.max(max, whole ? 4 : 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw && (!whole || Number.isInteger(s))) ?? Math.ceil(raw);
  return { top: step * 4, step };
}

/** A path through the values on a 100 × 100 box; a gap where a value is missing. */
function pathOf(values: (number | null)[], top: number) {
  const n = values.length;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = n === 1 ? 50 : (i / (n - 1)) * 100;
    const y = top ? 100 - (v / top) * 100 : 100;
    d += `${pen ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    pen = true;
  });
  return d.trim();
}

/** A tiny trend line for a number tile: the shape of the period, no axis. Decoration only (the tile says the number). */
export function Sparkline({ values, className = "" }: { values: (number | null)[]; className?: string }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const top = (Math.max(...known) || 1) * 1.1;
  const line = pathOf(values, top);
  const filled = values.every((v) => v !== null);
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className={`h-9 w-full overflow-visible ${className}`}>
      {filled && <path d={`${line} L100,100 L0,100 Z`} className="fill-brand-600/10 dark:fill-brand-400/10" />}
      <path d={line} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-brand-700 dark:stroke-brand-400" />
    </svg>
  );
}

/**
 * A line over time with its axis, gridlines and a hover readout per day; optionally the previous
 * period's line, dashed and grey, under it (same measure, same axis).
 */
export function TrendChart({
  title,
  points,
  previous,
  previousLabel,
  unit,
  whole = false,
  axis = (v) => v.toLocaleString("en-US"),
  t = EN,
  tick = (label) => label.slice(5),
}: {
  title: string;
  points: Point[];
  /** The previous period's values, day for day with `points`. */
  previous?: { value: number; display: string }[];
  /** What the dashed line is ("Previous 7 days"). */
  previousLabel?: string;
  unit?: string;
  /** Counts: whole numbers on the axis. */
  whole?: boolean;
  axis?: (v: number) => string;
  t?: T;
  tick?: (label: string) => string;
}) {
  const n = points.length;
  const prev = previous && previous.length === n ? previous : undefined;
  const prevName = previousLabel ?? t("Previous period");
  const { top, step } = niceScale(Math.max(0, ...points.map((p) => p.value), ...(prev ?? []).map((p) => p.value)), whole);
  const at = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const line = pathOf(points.map((p) => p.value), top);
  const every = Math.max(1, Math.ceil(n / 7));
  const width = 100 / Math.max(n - 1, 1);
  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="text-sm font-medium text-slate-900 dark:text-white">{title}</span>
        {prev && (
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-brand-700 dark:bg-brand-400" />
              {t("This period")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-4 border-t-2 border-dashed border-slate-400 dark:border-slate-500" />
              {prevName}
            </span>
          </span>
        )}
      </figcaption>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* The value axis. */}
        <div aria-hidden className="relative h-44 w-14 text-right text-[10px] text-slate-500 tabular-nums">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="absolute right-0 translate-y-1/2" style={{ bottom: `${i * 25}%` }}>
              {axis(i * step)}
            </span>
          ))}
        </div>
        <div className="relative h-44" role="img" aria-label={t("{title}, {n} days", { title, n })}>
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={`absolute inset-x-0 h-px ${i ? "bg-slate-100 dark:bg-slate-800" : "bg-slate-300 dark:bg-slate-700"}`}
              style={{ bottom: `${i * 25}%` }}
            />
          ))}
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {prev && (
              <path
                d={pathOf(prev.map((p) => p.value), top)}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                className="stroke-slate-400 dark:stroke-slate-500"
              />
            )}
            {n > 1 && <path d={`${line} L100,100 L0,100 Z`} className="fill-brand-600/10 dark:fill-brand-400/10" />}
            <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-brand-700 dark:stroke-brand-400" />
          </svg>
          {/* One hover target per day: a crosshair, the point, and the day's numbers. */}
          {points.map((p, i) => {
            const x = at(i);
            const align = x > 70 ? "right-1/2" : x < 30 ? "left-1/2" : "left-1/2 -translate-x-1/2";
            return (
              <div key={p.label} className="group absolute inset-y-0" style={{ left: `${x - width / 2}%`, width: `${width}%` }}>
                <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-slate-300 opacity-0 group-hover:opacity-100 dark:bg-slate-600" />
                <span
                  aria-hidden
                  className="absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-brand-700 opacity-0 ring-2 ring-white group-hover:opacity-100 dark:bg-brand-400 dark:ring-slate-900"
                  style={{ bottom: `${top ? (p.value / top) * 100 : 0}%` }}
                />
                <span
                  className={`pointer-events-none absolute -top-2 z-10 hidden -translate-y-full rounded-md bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-raised group-hover:block dark:bg-slate-100 dark:text-slate-900 ${align}`}
                >
                  <span className="block font-medium">{p.label}</span>
                  <span className="block tabular-nums">
                    {p.display}
                    {unit && ` ${unit}`}
                  </span>
                  {prev && (
                    <span className="block text-slate-300 tabular-nums dark:text-slate-600">
                      {prevName}: {prev[i].display}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <span />
        <div aria-hidden className="relative mt-1.5 h-4 text-[10px] text-slate-500">
          {points.map((p, i) =>
            i === 0 || i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2) ? (
              <span key={p.label} className={`absolute top-0 whitespace-nowrap ${i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2 max-sm:hidden"}`} style={{ left: `${at(i)}%` }}>
                {tick(p.label)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </figure>
  );
}

/** The five shades of a heatmap cell, fewest to most; dark mode runs dark to bright. */
const HEAT = [
  "bg-brand-100 dark:bg-brand-950",
  "bg-brand-200 dark:bg-brand-900",
  "bg-brand-400 dark:bg-brand-700",
  "bg-brand-600 dark:bg-brand-500",
  "bg-brand-800 dark:bg-brand-300",
];

/**
 * Counts on a grid (rows × columns), each cell shaded by how many: here, check-ins by weekday and
 * hour. Hover a cell for its number; the page names the busiest cell in words, so the shade is
 * never the only way to read it.
 */
export function Heatmap({
  rows,
  cols,
  values,
  cell,
  label,
  t = EN,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  /** The hover text of a cell ("Monday 09:00: 12 check-ins"). */
  cell: (row: number, col: number, value: number) => string;
  label: string;
  t?: T;
}) {
  const max = Math.max(0, ...values.flat());
  const shade = (v: number) => (v === 0 ? "bg-slate-100 dark:bg-slate-800/70" : HEAT[Math.min(HEAT.length - 1, Math.ceil((v / max) * HEAT.length) - 1)]);
  const every = cols.length > 12 ? 2 : 1;
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto pt-8 -mt-8">
        <div className="grid min-w-md gap-[3px]" style={{ gridTemplateColumns: `2.75rem repeat(${cols.length}, minmax(0, 1fr))` }} role="img" aria-label={label}>
          {values.map((row, r) => (
            <div key={rows[r]} className="contents">
              <span className="self-center pr-2 text-right text-xs text-slate-500">{rows[r]}</span>
              {row.map((v, c) => (
                <span key={c} className={`group relative h-6 rounded-[4px] ${shade(v)}`}>
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-raised group-hover:block dark:bg-slate-100 dark:text-slate-900">
                    {cell(r, c, v)}
                  </span>
                </span>
              ))}
            </div>
          ))}
          <span />
          {cols.map((c, i) => (
            <span key={c} aria-hidden className="pt-1 text-center text-[10px] text-slate-500 tabular-nums">
              {i % every === 0 ? c : ""}
            </span>
          ))}
        </div>
      </div>
      <figcaption aria-hidden className="flex items-center justify-end gap-1.5 text-[11px] text-slate-500">
        {t("Fewer")}
        {HEAT.map((h) => (
          <span key={h} className={`size-3 rounded-[3px] ${h}`} />
        ))}
        {t("More")}
      </figcaption>
    </figure>
  );
}

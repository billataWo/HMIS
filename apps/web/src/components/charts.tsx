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
export function ColumnChart({ title, points, unit }: { title: string; points: Point[]; unit?: string }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-zinc-500">peak {points.find((p) => p.value === max)?.display ?? "0"}</span>
      </figcaption>
      <div className="flex h-40 items-end gap-[2px] border-b border-zinc-300 dark:border-zinc-700" role="img" aria-label={`${title}, ${points.length} days`}>
        {points.map((p) => (
          <div key={p.label} className="group relative flex h-full min-w-[3px] flex-1 items-end justify-center">
            <div
              className="w-full max-w-6 rounded-t-[4px] bg-teal-700 transition-opacity group-hover:opacity-80 dark:bg-teal-500"
              style={{ height: max ? `${Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0)}%` : 0 }}
            />
            <span className="pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded bg-zinc-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow group-hover:block dark:bg-zinc-100 dark:text-zinc-900">
              {p.label}: {p.display}
              {unit && ` ${unit}`}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] text-[10px] text-zinc-500">
        {points.map((p, i) => (
          <span key={p.label} className="min-w-[3px] flex-1 text-center">
            {i === 0 || i === points.length - 1 || i % every === 0 ? p.label.slice(5) : ""}
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
    <ul className="space-y-1.5 text-sm">
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
          <span className="truncate">{i.label}</span>
          <span className="text-right tabular-nums text-zinc-600 dark:text-zinc-400">{i.display}</span>
          <span className="col-span-2 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <span className="block h-full rounded-full bg-teal-700 dark:bg-teal-500" style={{ width: max ? `${(i.value / max) * 100}%` : 0 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

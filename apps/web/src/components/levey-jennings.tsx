import type { LabQcRun } from "@/lib/api";
import { EN } from "@/lib/format";
import type { T } from "@/lib/i18n";

// Drawn small and scaled to at most 28rem wide, so the labels read the same on a phone and a desk.
const W = 340;
const H = 140;
const PAD = { l: 36, r: 8, t: 8, b: 8 };
const LIMIT = 4; // SDs shown either side of the mean; runs beyond are drawn at the edge

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Addis_Ababa" });

/**
 * A Levey-Jennings chart: a measured control's runs, oldest to newest, in SDs from its mean, with
 * the ±2 SD (warning) and ±3 SD (failure) lines. Each point names its run on hover; failed and
 * warning runs are marked by colour and shape.
 */
export function LeveyJennings({ runs, unit, t = EN }: { runs: LabQcRun[]; unit?: string | null; t?: T }) {
  const points = runs.filter((r) => r.z !== null).reverse();
  if (points.length < 2) return <p className="text-xs text-slate-500">{t("The chart appears after two runs.")}</p>;
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(points.length - 1, 1);
  const y = (z: number) => PAD.t + ((LIMIT - Math.max(-LIMIT, Math.min(LIMIT, z))) * (H - PAD.t - PAD.b)) / (2 * LIMIT);
  const lines: [number, string, string][] = [
    [3, "stroke-red-400 dark:stroke-red-500", "+3SD"],
    [2, "stroke-amber-400 dark:stroke-amber-500", "+2SD"],
    [1, "stroke-slate-200 dark:stroke-slate-700", "+1SD"],
    [0, "stroke-slate-400 dark:stroke-slate-500", "mean"],
    [-1, "stroke-slate-200 dark:stroke-slate-700", "−1SD"],
    [-2, "stroke-amber-400 dark:stroke-amber-500", "−2SD"],
    [-3, "stroke-red-400 dark:stroke-red-500", "−3SD"],
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-md" role="img" aria-label={t("Levey-Jennings chart of the last {n} runs", { n: points.length })}>
      {lines.map(([z, cls, label]) => (
        <g key={z}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(z)} y2={y(z)} className={cls} strokeWidth={1} strokeDasharray={Math.abs(z) >= 2 ? "4 3" : undefined} />
          <text x={PAD.l - 6} y={y(z) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">
            {label}
          </text>
        </g>
      ))}
      <polyline
        points={points.map((r, i) => `${x(i)},${y(Number(r.z))}`).join(" ")}
        fill="none"
        className="stroke-brand-600 dark:stroke-brand-400"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {points.map((r, i) => {
        const z = Number(r.z);
        const label = `${when(r.createdAt)} · ${r.value}${unit ? ` ${unit}` : ""} (${z >= 0 ? "+" : ""}${z.toFixed(1)} SD) · ${r.status === "PASS" ? "pass" : `${r.status === "FAIL" ? "fail" : "warning"} ${r.rule ?? ""}`}`;
        return r.status === "FAIL" ? (
          // A failed run: a square, so it stands out without colour too.
          <rect key={r.id} x={x(i) - 5} y={y(z) - 5} width={10} height={10} className="fill-red-600 stroke-white dark:stroke-slate-900" strokeWidth={2}>
            <title>{label}</title>
          </rect>
        ) : (
          <circle
            key={r.id}
            cx={x(i)}
            cy={y(z)}
            r={r.status === "WARN" ? 5 : 4}
            className={`${r.status === "WARN" ? "fill-amber-500" : "fill-brand-600 dark:fill-brand-400"} stroke-white dark:stroke-slate-900`}
            strokeWidth={2}
          >
            <title>{label}</title>
          </circle>
        );
      })}
    </svg>
  );
}

import type { LabFlag, LabOrder } from "@/lib/api";

export const LAB_STATUS: Record<LabOrder["status"], string> = {
  ORDERED: "Ordered",
  SAMPLE_COLLECTED: "Sample taken",
  RESULTED: "Awaiting verification",
  VERIFIED: "Verified",
  CANCELLED: "Cancelled",
};

type Ranged = { refLow: string | null; refHigh: string | null; unit: string | null };

/** "12–17 g/dL", "≥ 4", or null when there is no numeric range. Works for tests and panel components. */
export function rangeText(t: Ranged) {
  if (t.refLow === null && t.refHigh === null) return null;
  const lo = t.refLow !== null ? Number(t.refLow) : null;
  const hi = t.refHigh !== null ? Number(t.refHigh) : null;
  const range = lo !== null && hi !== null ? `${lo}–${hi}` : lo !== null ? `≥ ${lo}` : `≤ ${hi}`;
  return `${range}${t.unit ? ` ${t.unit}` : ""}`;
}

export const isCritical = (flag: string | null | undefined) => flag === "LL" || flag === "HH";
export const isAbnormal = (flag: string | null | undefined) => !!flag && flag !== "N";
export const FLAG_TEXT: Record<LabFlag, string> = { LL: "CRITICAL LOW", L: "LOW", N: "", H: "HIGH", HH: "CRITICAL HIGH" };

export function Flag({ flag }: { flag: string | null }) {
  if (!isAbnormal(flag)) return null;
  return (
    <span
      className={`ml-1 rounded px-1 text-xs font-semibold ${
        isCritical(flag) ? "bg-red-700 text-white dark:bg-red-600" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
      }`}
    >
      {FLAG_TEXT[flag as LabFlag]}
    </span>
  );
}

/**
 * A result with its unit and a flag, e.g. "9.5 g/dL LOW" (critical ones stand out). For a panel,
 * each component on its own line with the range it was judged by.
 */
export function LabValue({ o }: { o: LabOrder }) {
  if (o.resultValue === null) return null;
  const parts = o.labTest.components ?? [];
  if (parts.length && o.values?.length) {
    return (
      <span className="mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm sm:inline-grid">
        {parts.map((c) => {
          const v = o.values!.find((x) => x.componentId === c.id);
          if (!v) return null;
          return (
            <span key={c.id} className="contents">
              <span className="text-slate-500">{c.name}</span>
              <span className={isAbnormal(v.flag) ? "font-semibold text-red-700 dark:text-red-400" : "font-medium"}>
                {v.value}
                {c.unit && ` ${c.unit}`}
                <Flag flag={v.flag} />
                {v.rangeText && <span className="ml-1 text-xs font-normal text-slate-500">({v.rangeText})</span>}
              </span>
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <span className={isAbnormal(o.resultFlag) ? "font-semibold text-red-700 dark:text-red-400" : "font-medium"}>
      {o.resultValue}
      {o.labTest.unit && ` ${o.labTest.unit}`}
      <Flag flag={o.resultFlag} />
    </span>
  );
}

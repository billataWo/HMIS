import type { LabOrder } from "@/lib/api";

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

function Flag({ flag }: { flag: string | null }) {
  if (flag !== "H" && flag !== "L") return null;
  return <span className="ml-1 rounded bg-red-100 px-1 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{flag === "H" ? "HIGH" : "LOW"}</span>;
}

/**
 * A result with its unit and a high/low flag, e.g. "9.5 g/dL LOW". For a panel, each component on
 * its own line, abnormal ones highlighted.
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
          const abnormal = v.flag === "H" || v.flag === "L";
          return (
            <span key={c.id} className="contents">
              <span className="text-slate-500">{c.name}</span>
              <span className={abnormal ? "font-semibold text-red-700 dark:text-red-400" : "font-medium"}>
                {v.value}
                {c.unit && ` ${c.unit}`}
                <Flag flag={v.flag} />
              </span>
            </span>
          );
        })}
      </span>
    );
  }
  const abnormal = o.resultFlag === "H" || o.resultFlag === "L";
  return (
    <span className={abnormal ? "font-semibold text-red-700 dark:text-red-400" : "font-medium"}>
      {o.resultValue}
      {o.labTest.unit && ` ${o.labTest.unit}`}
      <Flag flag={o.resultFlag} />
    </span>
  );
}

import type { LabOrder } from "@/lib/api";

export const LAB_STATUS: Record<LabOrder["status"], string> = {
  ORDERED: "Ordered",
  SAMPLE_COLLECTED: "Sample taken",
  RESULTED: "Awaiting verification",
  VERIFIED: "Verified",
  CANCELLED: "Cancelled",
};

export function rangeText(t: LabOrder["labTest"]) {
  if (t.refLow === null && t.refHigh === null) return null;
  const lo = t.refLow !== null ? Number(t.refLow) : null;
  const hi = t.refHigh !== null ? Number(t.refHigh) : null;
  const range = lo !== null && hi !== null ? `${lo}–${hi}` : lo !== null ? `≥ ${lo}` : `≤ ${hi}`;
  return `${range}${t.unit ? ` ${t.unit}` : ""}`;
}

/** A result value with its unit and a high/low flag, e.g. "9.5 g/dL  LOW". */
export function LabValue({ o }: { o: LabOrder }) {
  if (o.resultValue === null) return null;
  const abnormal = o.resultFlag === "H" || o.resultFlag === "L";
  return (
    <span className={abnormal ? "font-semibold text-red-700 dark:text-red-400" : "font-medium"}>
      {o.resultValue}
      {o.labTest.unit && ` ${o.labTest.unit}`}
      {abnormal && <span className="ml-1 rounded bg-red-100 px-1 text-xs dark:bg-red-950">{o.resultFlag === "H" ? "HIGH" : "LOW"}</span>}
    </span>
  );
}

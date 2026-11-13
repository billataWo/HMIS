import type { VitalsRow } from "@/lib/api";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "Africa/Addis_Ababa" });

/**
 * The patient's vitals over their last visits, newest first: is the blood pressure coming down,
 * is the weight changing? High blood pressure (≥ 140/90) is marked.
 */
export function VitalsTrend({ rows }: { rows: VitalsRow[] }) {
  if (rows.length < 2) return null;
  const high = (r: VitalsRow) => (r.systolicBp ?? 0) >= 140 || (r.diastolicBp ?? 0) >= 90;
  return (
    <section className="surface space-y-2 p-4 text-sm dark:border-slate-800">
      <h2 className="font-semibold">Vitals over time</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-medium">Visit</th>
              <th className="py-1 pr-2 text-right font-medium">BP</th>
              <th className="py-1 pr-2 text-right font-medium">Pulse</th>
              <th className="py-1 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2 whitespace-nowrap">{day(r.checkedInAt)}</td>
                <td className={`py-1 pr-2 text-right ${high(r) ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
                  {r.systolicBp && r.diastolicBp ? `${r.systolicBp}/${r.diastolicBp}` : "—"}
                </td>
                <td className="py-1 pr-2 text-right">{r.pulse ?? "—"}</td>
                <td className="py-1 text-right">{r.weightKg ? `${Number(r.weightKg)} kg` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

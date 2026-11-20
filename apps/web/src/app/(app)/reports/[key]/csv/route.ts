import { csvResponse } from "@/app/platform/csv";
import { api, ApiError, type ReportResult } from "@/lib/api";
import { clinicToday } from "@/lib/format";
import { csvCell } from "@/lib/report-format";
import { reportByKey } from "@/lib/reports";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A library report as a CSV file: every row, the same columns as the page, a total line. The API
 * records the export in the audit log (most reports name patients).
 */
export async function GET(request: Request, { params }: RouteContext<"/reports/[key]/csv">) {
  const { key } = await params;
  const def = reportByKey(key);
  if (!def) return new Response("No such report", { status: 404 });
  const url = new URL(request.url);
  const today = clinicToday();
  const day = (k: string, fallback: string) => {
    const v = url.searchParams.get(k);
    return v && DAY.test(v) ? v : fallback;
  };
  const from = day("from", `${today.slice(0, 8)}01`);
  const to = day("to", today);
  const query = new URLSearchParams({ from, to });
  for (const f of def.filters ?? []) {
    const v = url.searchParams.get(f.name) ?? f.initial;
    if (v) query.set(f.name, v);
  }

  let result: ReportResult;
  try {
    result = await api<ReportResult>(`/reports/library/${key}/export?${query}`);
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) return new Response(e.message, { status: e.status });
    throw e;
  }
  const rows = result.rows.map((r) => def.columns.map((c) => csvCell(c, r[c.key])));
  if (result.totals) rows.push(def.columns.map((c, i) => (i === 0 ? "Total" : c.key in result.totals! ? csvCell(c, result.totals![c.key]) : null)));
  const header = def.columns.map((c) => (c.type === "money" ? `${c.label} (ETB)` : c.label));
  return csvResponse(def.asOfNow ? `${key}-${today}.csv` : `${key}-${from}-to-${to}.csv`, header, rows);
}

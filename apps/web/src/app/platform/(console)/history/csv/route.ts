import { type HistoryEntry, platformApi } from "@/lib/platform";
import { csvResponse, today } from "../../../csv";
import { kindOf } from "../../activity";

/** The console's history as a spreadsheet: the same filters as the page, up to 2,000 entries. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = new URLSearchParams([...params].filter(([k, v]) => ["area", "operatorId", "tenantId"].includes(k) && v));
  const rows: HistoryEntry[] = [];
  let before: string | null = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams(filters);
    if (before) q.set("before", before);
    const batch = await platformApi<HistoryEntry[]>(`/platform/audit?${q}`);
    rows.push(...batch);
    if (batch.length < 200) break;
    before = batch[batch.length - 1].createdAt;
  }
  return csvResponse(
    `hmis-history-${today()}.csv`,
    ["Time", "Operator", "Action", "What", "Clinic", "Details", "From"],
    rows.map((e) => [
      e.createdAt,
      e.operator ?? "HMIS",
      e.action,
      kindOf(e.action).label,
      e.clinic ?? "",
      e.data ? JSON.stringify(e.data) : "",
      e.ip ?? "",
    ]),
  );
}

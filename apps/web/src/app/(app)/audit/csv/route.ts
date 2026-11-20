import { csvResponse } from "@/app/platform/csv";
import { api, ApiError, type AuditEntry } from "@/lib/api";
import { actionLabel, deviceOf } from "@/lib/audit-actions";
import { CLINIC_TZ } from "@/lib/format";

const KEYS = ["from", "to", "userId", "action", "category", "sensitive", "patientId", "q"];
const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: CLINIC_TZ });

/**
 * The audit log as a CSV file, with the same filters as the page: oldest first, in Addis Ababa
 * time, with each entry's seal. The API records that the log was downloaded.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = new URLSearchParams();
  for (const k of KEYS) {
    const v = url.searchParams.get(k);
    if (v) query.set(k, v);
  }
  let res: { from: string; to: string; entries: AuditEntry[]; truncated: boolean };
  try {
    res = await api(`/audit/export?${query}`);
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) return new Response(e.message, { status: e.status });
    throw e;
  }
  const rows = res.entries.map((e) => {
    const at = new Date(e.createdAt);
    return [
      `${day.format(at)} ${clock.format(at)}`,
      e.user?.fullName ?? "System",
      e.user?.role ?? null,
      actionLabel(e.action) ?? e.action,
      e.action,
      e.category ?? null,
      e.sensitive ? "yes" : null,
      e.target?.label ?? (e.entityId ? `${e.entity} ${e.entityId}` : e.entity),
      e.data ? JSON.stringify(e.data) : null,
      e.ip ?? null,
      deviceOf(e.userAgent),
      e.id,
      e.seal ?? null,
    ];
  });
  return csvResponse(
    `audit-log-${res.from}-to-${res.to}.csv`,
    ["Time (Addis Ababa)", "Staff", "Role", "Action", "Action code", "Area", "Second look", "About", "Details", "Address", "Browser", "Entry", "Seal"],
    rows,
  );
}

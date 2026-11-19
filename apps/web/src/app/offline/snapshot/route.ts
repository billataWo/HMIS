import { cookies } from "next/headers";
import { API_URL, TOKEN_COOKIE, type LabOrder, type Me, type Prescription, type QueueResponse, type SyncStatus, type VisitDetail } from "@/lib/api";
import type { Snapshot } from "@/lib/offline/types";

/** Roles that get each part of the snapshot (the API checks again; a refusal just leaves it empty). */
const LAB_ROLES = new Set(["ADMIN", "LAB_TECH"]);
const PHARMACY_ROLES = new Set(["ADMIN", "PHARMACIST"]);
const CASH_ROLES = new Set(["ADMIN", "CASHIER"]);
const ORDERING = new Set(["ADMIN", "DOCTOR", "NURSE", "LAB_TECH"]);
/** Open visits kept in full (doctors and nurses): those in consultation first, then the waiting. */
const MAX_VISITS = 40;

/** When the sign-in token expires (its `exp` claim), so the offline workspace can lock then. */
function tokenExpiry(token: string): string | null {
  try {
    const { exp } = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { exp?: number };
    return exp ? new Date(exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Everything the signed-in user needs to keep working offline, in one download, for the
 * browser's offline store. Requested by the status chip every few minutes while online.
 */
export async function GET() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ message: "Signed out" }, { status: 401 });
  const get = async <T>(path: string, fallback: T): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    return res?.ok ? ((await res.json()) as T) : fallback;
  };

  const meRes = await fetch(`${API_URL}/auth/me`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!meRes) return Response.json({ message: "The HMIS server cannot be reached" }, { status: 503 });
  if (!meRes.ok) return Response.json({ message: "Signed out" }, { status: 401 });
  const me = (await meRes.json()) as Me;
  // Turned off in Settings: this PC keeps no patient data (the browser deletes what it has).
  if (me.tenant.offlineMode === false) return Response.json({ message: "Offline mode is turned off for this clinic", code: "OFFLINE_MODE_OFF" }, { status: 409 });
  const role = me.role;
  // The API's clock just before any data is read: work it applied before this is in the data.
  // (The same clock stamps applied offline work; this server's clock is only a fallback.)
  const at = meRes.headers.get("x-server-time") ?? new Date().toISOString();

  const [queue, patients, services, labTests, reference, lab, pharmacy, bills, sync] = await Promise.all([
    get<QueueResponse>("/queue", { day: "", prepayment: false, visits: [] }),
    get<Snapshot["patients"]>("/patients?take=100", []),
    get<Snapshot["services"]>("/lookups/services", []),
    ORDERING.has(role) ? get<Snapshot["labTests"]>("/lab/tests", []) : Promise.resolve([]),
    get<{ icd: Snapshot["icd"]; drugs: Snapshot["drugs"] }>("/offline/reference", { icd: [], drugs: [] }),
    LAB_ROLES.has(role) ? get<{ open: Snapshot["lab"] }>("/lab/worklist", { open: [] }) : Promise.resolve({ open: [] }),
    PHARMACY_ROLES.has(role) ? get<{ open: Snapshot["pharmacy"] }>("/pharmacy/queue", { open: [] }) : Promise.resolve({ open: [] }),
    // Unbilled charges and open invoice balances: what each visit still owes.
    CASH_ROLES.has(role) ? get<Snapshot["bills"]>("/billing/owed", []) : Promise.resolve([]),
    get<SyncStatus | null>("/sync/status", null),
  ]);

  // Doctors and nurses carry on with today's open visits: triage, notes, tests and prescriptions
  // so far, and the patient's earlier visits (the doctor's). Waiting patients too: they are the
  // ones triaged and called in next. Emergencies first, then in arrival order, as on the queue.
  const visits: Snapshot["visits"] = {};
  if (role === "DOCTOR" || role === "NURSE") {
    const rank = (l?: string | null) => (l === "RED" ? 0 : l === "ORANGE" ? 1 : l === "YELLOW" ? 2 : 3);
    const open = queue.visits
      .filter((v) => v.status !== "COMPLETED" && v.status !== "CANCELLED")
      .sort((a, b) => Number(b.status !== "WAITING") - Number(a.status !== "WAITING") || rank(a.triageLevel) - rank(b.triageLevel))
      .slice(0, MAX_VISITS);
    const details = await Promise.all(
      open.map(async (v) => {
        const [detail, labOrders, prescriptions] = await Promise.all([
          get<VisitDetail | null>(`/visits/${v.id}`, null),
          role === "DOCTOR" ? get<LabOrder[]>(`/visits/${v.id}/lab-orders`, []) : Promise.resolve([]),
          role === "DOCTOR" ? get<Prescription[]>(`/visits/${v.id}/prescriptions`, []) : Promise.resolve([]),
        ]);
        return detail && { ...detail, labOrders, prescriptions };
      }),
    );
    for (const d of details) if (d) visits[d.id] = d;
  }

  const snapshot: Snapshot = {
    at,
    validUntil: tokenExpiry(token),
    readOnly: sync?.mode === "cloud-copy",
    me,
    prepayment: queue.prepayment,
    queue: queue.visits,
    patients,
    services,
    labTests,
    drugs: reference.drugs,
    icd: reference.icd,
    visits,
    lab: lab.open,
    pharmacy: pharmacy.open,
    bills,
  };
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}

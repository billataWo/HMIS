import { cookies } from "next/headers";
import { API_URL, TOKEN_COOKIE, type LabOrder, type Me, type Prescription, type QueueResponse, type SyncStatus, type VisitDetail } from "@/lib/api";
import type { Snapshot } from "@/lib/offline/types";

/** Roles that get each part of the snapshot (the API checks again; a refusal just leaves it empty). */
const LAB_ROLES = new Set(["ADMIN", "LAB_TECH"]);
const PHARMACY_ROLES = new Set(["ADMIN", "PHARMACIST"]);
const CASH_ROLES = new Set(["ADMIN", "CASHIER"]);
const ORDERING = new Set(["ADMIN", "DOCTOR", "NURSE", "LAB_TECH"]);

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

  // Doctors carry on with their open visits: their notes, tests and prescriptions so far.
  const visits: Snapshot["visits"] = {};
  if (role === "DOCTOR") {
    const open = queue.visits.filter((v) => v.status !== "WAITING" && v.status !== "COMPLETED" && v.status !== "CANCELLED").slice(0, 25);
    const details = await Promise.all(
      open.map(async (v) => {
        const [detail, labOrders, prescriptions] = await Promise.all([
          get<VisitDetail | null>(`/visits/${v.id}`, null),
          get<LabOrder[]>(`/visits/${v.id}/lab-orders`, []),
          get<Prescription[]>(`/visits/${v.id}/prescriptions`, []),
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

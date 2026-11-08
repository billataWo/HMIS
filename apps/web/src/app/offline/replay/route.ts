import { cookies } from "next/headers";
import { API_URL, TOKEN_COOKIE } from "@/lib/api";

const ID = "[0-9a-f-]{36}";
/** The only requests offline work may replay (the same ones the offline workspace queues). */
const ALLOWED: [string, RegExp][] = [
  ["POST", /^\/patients$/],
  ["POST", /^\/visits$/],
  ["PATCH", new RegExp(`^/visits/${ID}$`)],
  ["PATCH", new RegExp(`^/visits/${ID}/status$`)],
  ["POST", new RegExp(`^/visits/${ID}/(diagnoses|lab-orders|prescriptions|payments)$`)],
  ["POST", new RegExp(`^/lab-orders/${ID}/(collect|result|verify)$`)],
  ["POST", new RegExp(`^/prescriptions/${ID}/(bill|dispense)$`)],
];

/**
 * Sends one queued offline request to the API as the signed-in user, with its Idempotency-Key
 * so a resend after a lost reply is applied once. The browser can't add the sign-in itself: the
 * token cookie is not readable by scripts.
 */
export async function POST(request: Request) {
  // Only this app's own pages may use it (the sign-in cookie is SameSite=Lax as well).
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === host;
    } catch {}
    if (!sameSite) return Response.json({ message: "Not allowed from another site" }, { status: 403 });
  }
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ message: "Signed out" }, { status: 401 });
  const { method, path, body, key } = (await request.json().catch(() => ({}))) as { method?: string; path?: string; body?: unknown; key?: string };
  if (!method || !path || !key || !ALLOWED.some(([m, re]) => m === method && re.test(path))) {
    return Response.json({ message: "This request cannot be replayed from offline work" }, { status: 400 });
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return Response.json({ message: "The HMIS server cannot be reached" }, { status: 503 });
  }
  const text = await res.text();
  const headers: Record<string, string> = { "content-type": "application/json" };
  // When the API applied it, by its clock: compared with snapshot times in the browser.
  const serverTime = res.headers.get("x-server-time");
  if (serverTime) headers["x-server-time"] = serverTime;
  return new Response(text || "{}", { status: res.status, headers });
}

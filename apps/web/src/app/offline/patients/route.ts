import { cookies } from "next/headers";
import { API_URL, TOKEN_COOKIE } from "@/lib/api";

/**
 * The clinic's patients for the front desk's offline search (lib/offline/engine.ts,
 * refreshPatients): requested every few hours while online, with the sign-in the browser can't read.
 */
export async function GET() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ message: "Signed out" }, { status: 401 });
  const res = await fetch(`${API_URL}/offline/patients`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res) return Response.json({ message: "The HMIS server cannot be reached" }, { status: 503 });
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  const serverTime = res.headers.get("x-server-time");
  if (serverTime) headers["x-server-time"] = serverTime;
  return new Response(await res.text(), { status: res.status, headers });
}

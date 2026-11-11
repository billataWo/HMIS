import { cookies } from "next/headers";
import { API_URL } from "@/lib/api";
import { PLATFORM_COOKIE } from "@/lib/platform";

/**
 * The recorded voice, for the console's studio (to listen and preview calls) and, with
 * ?download=1, as a file to load on a clinic's own server (`cli.js voice-import <file>`).
 */
export async function GET(request: Request) {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) return Response.json({ message: "Sign in again" }, { status: 401 });
  const res = await fetch(`${API_URL}/platform/voice`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (!res) return Response.json({ message: "Cannot reach the HMIS server" }, { status: 502 });
  const download = new URL(request.url).searchParams.has("download");
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(download && res.ok && { "Content-Disposition": 'attachment; filename="hmis-voice.json"' }),
    },
  });
}

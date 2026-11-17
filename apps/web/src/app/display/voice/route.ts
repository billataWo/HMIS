// i18n: english-only — read by the TV's script, never shown.
import { cookies } from "next/headers";
import { API_URL } from "@/lib/api";

/**
 * The recorded calling voice, for the paired TV (its display key is an httpOnly cookie, so the
 * page asks here). The TV asks with the pack's version (?v=), so a browser may keep the answer
 * until the voice changes.
 */
export async function GET(request: Request) {
  const token = (await cookies()).get("hmis_display")?.value;
  if (!token) return Response.json({ message: "This screen is not paired" }, { status: 401 });
  const res = await fetch(`${API_URL}/display/voice`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (!res) return Response.json({ message: "Cannot reach the HMIS server" }, { status: 502 });
  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": res.ok && versioned ? "private, max-age=31536000, immutable" : "no-store",
    },
  });
}

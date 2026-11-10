"use server";

import { cookies } from "next/headers";
import { clientAddress } from "@/lib/client-address";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";

/** The screen's own key: unreadable by scripts, sent only to this site, kept for a year. */
const DISPLAY_COOKIE = "hmis_display";

export type PairState = { error?: string };

/** On the TV: the 6-digit code from Settings → Screens, entered once. */
export async function pairDisplay(_: PairState, form: FormData): Promise<PairState> {
  const forwarded = await clientAddress();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/display/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(forwarded && { "X-Forwarded-For": forwarded }) },
      body: JSON.stringify({ code: String(form.get("code") ?? "").replace(/\s/g, "") }),
      cache: "no-store",
    });
  } catch {
    return { error: "Cannot reach the HMIS server." };
  }
  const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string | string[] };
  if (!res.ok || !body.token) return { error: [body.message].flat().join(" ") || "That code did not work." };
  (await cookies()).set(DISPLAY_COOKIE, body.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60,
    path: "/",
  });
  redirect("/display");
}

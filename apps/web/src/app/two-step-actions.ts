"use server";

import { cookies } from "next/headers";
import { clientAddress, clientAgent } from "@/lib/client-address";
import { STAFF_BROWSER_COOKIE, STAFF_BROWSER_COOKIE_OPTIONS } from "@/lib/staff-browser";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { api, API_URL, ApiError, TOKEN_COOKIE } from "@/lib/api";

/** The password step's challenge, kept for the code step only (5 minutes, scripts can't read it). */
const CHALLENGE_COOKIE = "hmis_challenge";

const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

async function setSession(token: string) {
  (await cookies()).set(TOKEN_COOKIE, token, { ...cookieBase, maxAge: 12 * 60 * 60 });
  (await cookies()).set(STAFF_BROWSER_COOKIE, "1", { ...STAFF_BROWSER_COOKIE_OPTIONS, secure: cookieBase.secure });
}

export async function setChallenge(challenge: string) {
  (await cookies()).set(CHALLENGE_COOKIE, challenge, { ...cookieBase, maxAge: 5 * 60 });
}

export type TwoStepState = { error?: string; expired?: boolean };

/** Sign-in, second step: the code from the authenticator app, or a recovery code. */
export async function verifyTwoStep(_: TwoStepState, form: FormData): Promise<TwoStepState> {
  const store = await cookies();
  const challenge = store.get(CHALLENGE_COOKIE)?.value;
  if (!challenge) return { error: "The sign-in took too long. Enter your phone number and password again.", expired: true };
  const forwarded = await clientAddress();
  const agent = await clientAgent();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login/two-step`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(forwarded && { "X-Forwarded-For": forwarded }), ...(agent && { "User-Agent": agent }) },
      body: JSON.stringify({ challenge, code: String(form.get("code") ?? "").trim() }),
      cache: "no-store",
    });
  } catch {
    return { error: "Cannot reach the server. Check that the API is running." };
  }
  const body = (await res.json().catch(() => ({}))) as { token?: string; mustChangePassword?: boolean; message?: string; code?: string };
  if (body.code === "CHALLENGE_EXPIRED") {
    store.delete(CHALLENGE_COOKIE);
    return { error: "The sign-in took too long. Enter your phone number and password again.", expired: true };
  }
  if (!res.ok || !body.token) return { error: body.message ?? "That code is not right." };
  store.delete(CHALLENGE_COOKIE);
  await setSession(body.token);
  redirect(body.mustChangePassword ? "/account/password" : "/");
}

export type SetupState = { error?: string; secret?: string; qr?: string };

/** Starts adding the authenticator app: a new secret, as a QR code and as text to type in. */
export async function startTwoStepSetup(_: SetupState, form: FormData): Promise<SetupState> {
  try {
    const password = String(form.get("password") ?? "");
    const { secret, uri } = await api<{ secret: string; uri: string }>("/auth/two-step/setup", {
      method: "POST",
      body: JSON.stringify(password ? { password } : {}),
    });
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { secret, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "Could not start the setup." };
  }
}

export type CodesState = { error?: string; recoveryCodes?: string[] };

/** The first code confirms the app; returns the recovery codes. Other sign-ins end (new token). */
export async function enableTwoStep(_: CodesState, form: FormData): Promise<CodesState> {
  try {
    const { recoveryCodes, token } = await api<{ recoveryCodes: string[]; token: string }>("/auth/two-step/enable", {
      method: "POST",
      body: JSON.stringify({ code: String(form.get("code") ?? "").trim() }),
    });
    await setSession(token);
    return { recoveryCodes };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "Could not turn on two-step sign-in." };
  }
}

export async function renewRecoveryCodes(_: CodesState, form: FormData): Promise<CodesState> {
  try {
    const { recoveryCodes } = await api<{ recoveryCodes: string[] }>("/auth/two-step/recovery-codes", {
      method: "POST",
      body: JSON.stringify({ code: String(form.get("code") ?? "").trim() }),
    });
    return { recoveryCodes };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "Could not make new recovery codes." };
  }
}

export async function disableTwoStep(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  try {
    await api("/auth/two-step/disable", { method: "POST", body: JSON.stringify({ password: String(form.get("password") ?? "") }) });
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "Could not turn it off." };
  }
  redirect("/account/two-step?off=1");
}

/** An admin, for someone who lost their phone: they set two-step sign-in up again. */
export async function resetUserTwoStep(userId: string) {
  await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ resetTwoStep: true }) });
  redirect(`/users?done=${encodeURIComponent("Two-step sign-in was reset: they set it up again at their next sign-in.")}`);
}

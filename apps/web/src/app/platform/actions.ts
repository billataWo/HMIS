"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { clientAddress } from "@/lib/client-address";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { API_URL, ApiError } from "@/lib/api";
import { PLATFORM_CHALLENGE_COOKIE, PLATFORM_COOKIE, platformApi } from "@/lib/platform";

const cookieBase = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/platform" };

async function setSession(token: string) {
  (await cookies()).set(PLATFORM_COOKIE, token, { ...cookieBase, maxAge: 8 * 60 * 60 });
}

export type FormState = { error?: string; ok?: boolean; message?: string };

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const failure = (e: unknown): FormState => {
  if (e instanceof ApiError) return { error: e.body.errors?.map((x) => `${x.field ? `${x.field}: ` : ""}${x.message}`).join(". ") || e.message };
  throw e; // redirects (session ended) and unexpected errors
};

/** Calls the API before anyone is signed in (the two sign-in steps), passing on the address. */
async function signInCall(path: string, body: unknown) {
  const forwarded = await clientAddress();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(forwarded && { "X-Forwarded-For": forwarded }) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ─── Signing in ─────────────────────────────────────────────────────────────────────────────────
export async function platformLogin(_: FormState, form: FormData): Promise<FormState> {
  const { status, body } = await signInCall("/platform/auth/login", { email: text(form, "email"), password: String(form.get("password") ?? "") });
  if (status === 404) return { error: "The platform console is not available on this server." };
  if (status === 429) return { error: body.message ?? "Too many attempts. Wait 15 minutes." };
  if (status !== 200) return { error: "Wrong email or password." };
  if (body.twoStepRequired) {
    (await cookies()).set(PLATFORM_CHALLENGE_COOKIE, body.challenge, { ...cookieBase, maxAge: 5 * 60 });
    redirect("/platform/login/code");
  }
  await setSession(body.token);
  redirect("/platform/account");
}

export async function platformCode(_: FormState, form: FormData): Promise<FormState> {
  const store = await cookies();
  const challenge = store.get(PLATFORM_CHALLENGE_COOKIE)?.value;
  if (!challenge) return { error: "The sign-in took too long. Start again." };
  const { status, body } = await signInCall("/platform/auth/login/two-step", { challenge, code: text(form, "code") });
  if (status === 429) return { error: body.message ?? "Too many wrong codes. Wait 15 minutes." };
  if (status !== 200) return { error: "That code is not right." };
  store.delete({ name: PLATFORM_CHALLENGE_COOKIE, path: "/platform" });
  await setSession(body.token);
  redirect("/platform");
}

// ─── Own account ────────────────────────────────────────────────────────────────────────────────
export async function changeOperatorPassword(_: FormState, form: FormData): Promise<FormState> {
  if (text(form, "next") !== text(form, "confirm")) return { error: "The two new passwords are not the same." };
  try {
    const { token } = await platformApi<{ token: string }>("/platform/auth/password", {
      method: "POST",
      body: JSON.stringify({ current: String(form.get("current") ?? ""), next: String(form.get("next") ?? "") }),
    });
    await setSession(token);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, message: "Password changed." };
}

export type SetupState = FormState & { secret?: string; qr?: string; recoveryCodes?: string[] };

export async function startOperatorTwoStep(_: SetupState, form: FormData): Promise<SetupState> {
  try {
    const password = String(form.get("password") ?? "");
    const { secret, uri } = await platformApi<{ secret: string; uri: string }>("/platform/auth/two-step/setup", {
      method: "POST",
      body: JSON.stringify(password ? { password } : {}),
    });
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return { secret, qr };
  } catch (e) {
    return failure(e);
  }
}

export async function enableOperatorTwoStep(prev: SetupState, form: FormData): Promise<SetupState> {
  try {
    const { recoveryCodes, token } = await platformApi<{ recoveryCodes: string[]; token: string }>("/platform/auth/two-step/enable", {
      method: "POST",
      body: JSON.stringify({ code: text(form, "code") }),
    });
    await setSession(token);
    return { recoveryCodes };
  } catch (e) {
    return { ...prev, ...failure(e) };
  }
}

// ─── Requests ───────────────────────────────────────────────────────────────────────────────────
export type ApproveState = FormState & { approved?: { tenantId: string; clinicName: string; adminPhone: string; temporaryPassword: string } };

export async function approveRequest(id: string, _: ApproveState, form: FormData): Promise<ApproveState> {
  try {
    const approved = await platformApi<NonNullable<ApproveState["approved"]>>(`/platform/requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        planCode: text(form, "planCode"),
        deployment: text(form, "deployment"),
        trialDays: Number(text(form, "trialDays")),
        clinicName: text(form, "clinicName") || undefined,
        adminName: text(form, "adminName") || undefined,
        adminPhone: text(form, "adminPhone") || undefined,
      }),
    });
    return { approved };
  } catch (e) {
    return failure(e);
  }
}

export async function rejectRequest(id: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    await platformApi(`/platform/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: text(form, "reason") }) });
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

// ─── Clinics, invoices, payments ────────────────────────────────────────────────────────────────
export async function updateSubscription(tenantId: string, _: FormState, form: FormData): Promise<FormState> {
  const date = (name: string) => (form.has(name) ? text(form, name) || null : undefined);
  try {
    await platformApi(`/platform/clinics/${tenantId}/subscription`, {
      method: "PATCH",
      body: JSON.stringify({
        planId: text(form, "planId") || undefined,
        billingCycle: text(form, "billingCycle") || undefined,
        deployment: text(form, "deployment") || undefined,
        graceDays: form.has("graceDays") ? Number(text(form, "graceDays")) : undefined,
        trialEndsAt: date("trialEndsAt"),
        paidUntil: date("paidUntil"),
        notes: form.has("notes") ? text(form, "notes") || null : undefined,
      }),
    });
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function clinicAction(tenantId: string, kind: "suspend" | "reactivate" | "cancel", _: FormState, form: FormData): Promise<FormState> {
  try {
    await platformApi(`/platform/clinics/${tenantId}/${kind}`, { method: "POST", body: JSON.stringify(kind === "reactivate" ? {} : { reason: text(form, "reason") }) });
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

export async function issueInvoice(tenantId: string): Promise<FormState> {
  try {
    const invoice = await platformApi<{ number: string }>(`/platform/clinics/${tenantId}/invoices`, { method: "POST" });
    refresh();
    return { ok: true, message: `Invoice ${invoice.number} issued.` };
  } catch (e) {
    return failure(e);
  }
}

export async function voidInvoice(invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    await platformApi(`/platform/invoices/${invoiceId}/void`, { method: "POST", body: JSON.stringify({ reason: text(form, "reason") }) });
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

export async function recordPayment(invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const result = await platformApi<{ paidInFull: boolean }>(`/platform/invoices/${invoiceId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: text(form, "amount"), method: text(form, "method"), reference: text(form, "reference") || undefined, paidAt: text(form, "paidAt") }),
    });
    refresh();
    return { ok: true, message: result.paidInFull ? "Recorded: the invoice is paid." : "Recorded: part of the invoice is paid." };
  } catch (e) {
    return failure(e);
  }
}

export async function reviewPayment(paymentId: string, decision: "confirm" | "reject", _: FormState, form: FormData): Promise<FormState> {
  try {
    await platformApi(`/platform/payments/${paymentId}/${decision}`, { method: "POST", body: JSON.stringify(decision === "reject" ? { reason: text(form, "reason") } : {}) });
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true };
}

// ─── Plans, operators, settings ─────────────────────────────────────────────────────────────────
export async function savePlan(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  const maxStaff = text(form, "maxStaff");
  try {
    await platformApi(id ? `/platform/plans/${id}` : "/platform/plans", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({
        code: text(form, "code"),
        name: text(form, "name"),
        description: text(form, "description") || null,
        priceMonthly: text(form, "priceMonthly"),
        priceYearly: text(form, "priceYearly"),
        maxStaff: maxStaff ? Number(maxStaff) : null,
        features: form.getAll("features").map(String),
        active: form.get("active") === "on",
        sortOrder: Number(text(form, "sortOrder") || 0),
      }),
    });
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export type OperatorState = FormState & { temporaryPassword?: string; email?: string };

export async function addOperator(_: OperatorState, form: FormData): Promise<OperatorState> {
  try {
    const created = await platformApi<{ email: string; temporaryPassword: string }>("/platform/operators", {
      method: "POST",
      body: JSON.stringify({ fullName: text(form, "fullName"), email: text(form, "email"), role: text(form, "role") }),
    });
    refresh();
    return { ok: true, ...created };
  } catch (e) {
    return failure(e);
  }
}

export async function updateOperator(id: string, change: Record<string, unknown>): Promise<OperatorState> {
  try {
    const result = await platformApi<{ temporaryPassword?: string }>(`/platform/operators/${id}`, { method: "PATCH", body: JSON.stringify(change) });
    refresh();
    return { ok: true, temporaryPassword: result.temporaryPassword };
  } catch (e) {
    return failure(e);
  }
}

export async function saveSettings(_: FormState, form: FormData): Promise<FormState> {
  try {
    await platformApi("/platform/settings", {
      method: "PATCH",
      body: JSON.stringify({
        trialDays: Number(text(form, "trialDays")),
        graceDays: Number(text(form, "graceDays")),
        vatPercent: Number(text(form, "vatPercent")),
        bankDetails: text(form, "bankDetails") || null,
        supportPhone: text(form, "supportPhone") || null,
        supportEmail: text(form, "supportEmail") || null,
        autoInvoice: form.get("autoInvoice") === "on",
        invoiceDaysBefore: Number(text(form, "invoiceDaysBefore")),
        dataRetentionDays: Number(text(form, "dataRetentionDays")),
      }),
    });
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

/** The licence file for a clinic on its own server (the browser saves it). */
export async function licenceFile(tenantId: string): Promise<FormState & { filename?: string; licence?: string; endsAt?: string }> {
  try {
    return await platformApi<{ filename: string; licence: string; endsAt: string }>(`/platform/clinics/${tenantId}/licence`);
  } catch (e) {
    return failure(e);
  }
}

/** Deletes a cancelled clinic's records (owners; confirmed with the clinic's name). */
export async function deleteClinicData(tenantId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const r = await platformApi<{ rows: number }>(`/platform/clinics/${tenantId}/delete-data`, { method: "POST", body: JSON.stringify({ confirmName: text(form, "confirmName") }) });
    refresh();
    return { ok: true, message: `Deleted ${r.rows} records.` };
  } catch (e) {
    return failure(e);
  }
}

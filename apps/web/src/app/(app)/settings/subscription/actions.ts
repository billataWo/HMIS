"use server";

import { refresh } from "next/cache";
import { api, ApiError } from "@/lib/api";

export type TransferState = { error?: string; done?: boolean };

/** "We paid by bank transfer": HMIS confirms it once it shows on their statement. */
export async function reportTransfer(invoiceId: string, _: TransferState, form: FormData): Promise<TransferState> {
  try {
    await api(`/subscription/invoices/${invoiceId}/bank-transfer`, {
      method: "POST",
      body: JSON.stringify({
        reference: String(form.get("reference") ?? "").trim(),
        amount: String(form.get("amount") ?? "").trim(),
        paidAt: String(form.get("paidAt") ?? ""),
      }),
    });
    refresh();
    return { done: true };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.body.errors?.map((x) => x.message).join(". ") || e.message };
    return { error: "Could not send it. Try again." };
  }
}

export type PayState = { error?: string };

/** Starts an online payment; the browser then goes to the provider's payment page. */
export async function payOnline(invoiceId: string, provider: "CHAPA" | "TELEBIRR"): Promise<PayState & { url?: string }> {
  try {
    const { url } = await api<{ url: string }>(`/subscription/invoices/${invoiceId}/checkout`, { method: "POST", body: JSON.stringify({ provider }) });
    return { url };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: "Could not start the payment. Try again." };
  }
}

export type CheckResult = { status: "CREATED" | "PAID" | "FAILED" | "EXPIRED"; provider: string; amount: string; applied: boolean; invoice: { number: string; status: string } | null };

/** Back from the payment page: asks HMIS (which asks the provider) whether it went through. */
export async function checkPayment(reference: string): Promise<CheckResult | null> {
  try {
    return await api<CheckResult>(`/subscription/checkouts/${encodeURIComponent(reference)}/check`, { method: "POST" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** An HMIS licence file, on a clinic server or own-server install. */
export async function installLicence(_: TransferState, form: FormData): Promise<TransferState> {
  try {
    await api("/subscription/licence", { method: "POST", body: JSON.stringify({ licence: String(form.get("licence") ?? "").trim() }) });
    refresh();
    return { done: true };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.body.errors?.map((x) => x.message).join(". ") || e.message };
    return { error: "Could not install it. Try again." };
  }
}

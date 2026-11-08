"use server";

import { refresh } from "next/cache";
import { api, ApiError } from "@/lib/api";

export type PairingState = { error?: string; name?: string; code?: string; expiresAt?: string };

async function pairing(run: () => Promise<{ name: string; code: string; expiresAt: string }>): Promise<PairingState> {
  try {
    const { name, code, expiresAt } = await run();
    refresh();
    return { name, code, expiresAt };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "Something went wrong." };
  }
}

export async function addScreen(_: PairingState, form: FormData): Promise<PairingState> {
  return pairing(() => api("/displays", { method: "POST", body: JSON.stringify({ name: String(form.get("name") ?? "") }) }));
}

export async function repairScreen(id: string): Promise<PairingState> {
  return pairing(() => api(`/displays/${id}/pairing-code`, { method: "POST" }));
}

export async function removeScreen(id: string) {
  await api(`/displays/${id}/revoke`, { method: "POST" });
  refresh();
}

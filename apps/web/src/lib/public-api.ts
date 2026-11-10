import "server-only";
import { clientAddress } from "./client-address";
import { API_URL } from "./api";

export interface PublicPlans {
  plans: { code: string; name: string; description: string | null; priceMonthly: string; priceYearly: string; maxStaff: number | null; features: string[] }[];
  features: Record<string, string>;
  trialDays: number;
  vatPercent: string;
  supportPhone: string | null;
  supportEmail: string | null;
}

/** The plans offered on the HMIS cloud, or null on a server that is not the HMIS cloud. */
export async function publicPlans(): Promise<PublicPlans | null> {
  try {
    const res = await fetch(`${API_URL}/public/plans`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PublicPlans) : null;
  } catch {
    return null;
  }
}

/** Calls a public API endpoint, passing on the visitor's address (for its per-address limits). */
export async function publicPost<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string; errors?: { field: string; message: string }[] }> {
  const forwarded = await clientAddress();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(forwarded && { "X-Forwarded-For": forwarded }) },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "Can't reach HMIS right now. Please try again later." };
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: data as T };
  const message = Array.isArray(data.message) ? data.message.join(", ") : (data.message ?? "Something went wrong.");
  return { ok: false, status: res.status, message, errors: data.errors };
}

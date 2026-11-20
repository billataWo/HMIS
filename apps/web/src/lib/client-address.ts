import "server-only";
import { headers } from "next/headers";

/**
 * The visitor's address, for the API's per-address limits (sign-in, requests, payments).
 *
 * It is taken from the right of X-Forwarded-For: each proxy adds the address it was reached from at
 * the end, and anything to the left of that may have been written by the visitor. Caddy (our own
 * servers) replaces the header with the one address it saw; a hosting platform's router (AletCloud)
 * adds to it. HMIS_PROXY_HOPS: how many proxies that add to the header stand in front of the web
 * app (default 1). Without any proxy (development), Next.js fills it in from the connection.
 */
export function addressFrom(forwardedFor: string | null | undefined): string | undefined {
  const hops = Math.max(1, Math.floor(Number(process.env.HMIS_PROXY_HOPS)) || 1);
  const list = forwardedFor?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return list.length ? list[Math.max(0, list.length - hops)] : undefined;
}

export async function clientAddress() {
  return addressFrom((await headers()).get("x-forwarded-for"));
}

/** The visitor's browser line, for the audit log ("Chrome on Windows"). */
export async function clientAgent() {
  return (await headers()).get("user-agent")?.slice(0, 300) ?? undefined;
}

/**
 * Who is really asking, for a call this web server makes to the API on the visitor's behalf: their
 * address and browser (recorded in the audit log), not this server's.
 */
export async function originHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const forwarded = addressFrom(incoming.get("x-forwarded-for"));
  const agent = incoming.get("user-agent")?.slice(0, 300);
  return { ...(forwarded && { "X-Forwarded-For": forwarded }), ...(agent && { "User-Agent": agent }) };
}

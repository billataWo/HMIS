import "server-only";
import type { NextRequest } from "next/server";
import { API_URL } from "./api";
import { addressFrom } from "./client-address";

/** Hop-by-hop headers, the ones fetch sets itself, and Expect (which fetch refuses to send). */
const DROP = new Set(["host", "connection", "expect", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-connection", "content-length", "x-forwarded-for", "cookie"]);

/**
 * Passes a request for an address that only the API answers (clinic servers syncing, payment
 * providers reporting payments) straight to the API, unchanged. On our own servers Caddy sends
 * these to the API itself and they never reach the web app. On a host with one public address
 * for both (AletCloud), they arrive here.
 *
 * The visitor's cookies are not passed on: these addresses authenticate with their own token or
 * signature, and never with a clinic sign-in.
 */
export async function passThrough(req: NextRequest): Promise<Response> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP.has(key)) headers.set(key, value);
  });
  const address = addressFrom(req.headers.get("x-forwarded-for"));
  if (address) headers.set("x-forwarded-for", address);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${req.nextUrl.pathname}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      cache: "no-store",
      redirect: "manual",
      ...(hasBody && { duplex: "half" }),
    } as RequestInit);
  } catch {
    return Response.json({ message: "The HMIS server is not reachable right now." }, { status: 502 });
  }
  const out = new Headers(res.headers);
  // fetch has already undone any compression.
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

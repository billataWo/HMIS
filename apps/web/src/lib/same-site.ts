import "server-only";

/**
 * True when a request that changes something was sent by a page of this site (cross-site request
 * forgery protection for route handlers that act with the sign-in cookie; server actions get the
 * same check from Next.js). The sign-in cookie is SameSite=Lax as well, so browsers do not send it
 * on another site's POST; this is the second lock.
 *  - Sec-Fetch-Site, set by every current browser, must say "same-origin";
 *  - Origin, when present, must be this site's own address.
 */
export function fromThisSite(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

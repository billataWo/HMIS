/**
 * HTTP status for error pages. A page that fails while loading shows only an error's `digest` in
 * the browser (Next.js keeps the message on the server in production), so errors from the API carry
 * their status there: "HMIS_HTTP:<status>:<random>". The random part keeps each error's digest its
 * own, so the server still logs every one. Used by lib/api.ts (server) and the error pages (browser).
 */

/** The error pages this app shows: not found, no access, failed, server unreachable. */
export type PageStatus = 403 | 404 | 500 | 503;

export const statusDigest = (status: number) => `HMIS_HTTP:${status}:${Math.random().toString(36).slice(2, 10)}`;

/** The status an error page should show for a thrown error (500 when it says nothing more). */
export function pageStatus(error: unknown): PageStatus {
  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : "";
  const status = Number(/^HMIS_HTTP:(\d{3}):/.exec(digest)?.[1]);
  if (status === 403 || status === 404 || status === 503) return status;
  // A 502/504 from a proxy in front of the API: the server can't be reached.
  if (status === 502 || status === 504) return 503;
  return 500;
}

/** The short reference staff can read out to support: the digest without its status prefix. */
export const errorReference = (error: unknown) => {
  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : "";
  return digest.replace(/^HMIS_HTTP:\d{3}:/, "") || undefined;
};

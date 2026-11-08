import type { Request } from 'express';

/**
 * Addresses allowed to tell us the real client address (X-Forwarded-For): by default only this
 * machine, where the web app runs next to the API. Add the web container's or reverse proxy's
 * address with TRUSTED_PROXIES="10.0.0.5,172.18.0.3" when they run elsewhere.
 */
const trusted = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', ...(process.env.TRUSTED_PROXIES?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])]);

/**
 * The address a request really came from, or null when it came through the web app without one
 * (then per-address limits can't tell users apart and are skipped; per-account limits still apply).
 * A forwarded address is believed only from a trusted proxy, so callers can't fake theirs.
 */
export function clientIp(req: Request): string | null {
  const socket = req.socket?.remoteAddress ?? '';
  if (!trusted.has(socket)) return socket || null;
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || null;
}

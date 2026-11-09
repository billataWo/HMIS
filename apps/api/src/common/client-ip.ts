import { isIPv4 } from 'node:net';
import type { Request } from 'express';

/** IPv4 addresses arrive as "::ffff:10.0.0.5" on a dual-stack socket. */
const plain = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
const ipv4 = (address: string) => address.split('.').reduce((n, part) => n * 256 + Number(part), 0);

/**
 * Addresses allowed to tell us the real client address (X-Forwarded-For): by default only this
 * machine, where the web app runs next to the API. Add the web container's or reverse proxy's
 * address, or an IPv4 range, with TRUSTED_PROXIES="10.0.0.5,172.30.70.0/24" when they run
 * elsewhere. (In deploy/compose.yml it is the private network that only HMIS's own containers are
 * on: the API is not reachable from outside it.)
 */
const entries = ['127.0.0.1', '::1', ...(process.env.TRUSTED_PROXIES?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])];
const exact = new Set(entries.filter((e) => !e.includes('/')).map(plain));
const ranges = entries
  .filter((e) => e.includes('/'))
  .map((e) => {
    const [base, bits] = e.split('/');
    const n = Number(bits);
    if (!isIPv4(base) || !Number.isInteger(n) || n < 0 || n > 32) throw new Error(`TRUSTED_PROXIES: "${e}" is not an IPv4 range like 172.30.70.0/24`);
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return { net: (ipv4(base) & mask) >>> 0, mask };
  });

export function isTrustedProxy(address: string) {
  const a = plain(address);
  if (exact.has(a)) return true;
  if (!ranges.length || !isIPv4(a)) return false;
  const n = ipv4(a);
  return ranges.some((r) => ((n & r.mask) >>> 0) === r.net);
}

/**
 * The address a request really came from, or null when it came through the web app without one
 * (then per-address limits can't tell users apart and are skipped; per-account limits still apply).
 * A forwarded address is believed only from a trusted proxy, so callers can't fake theirs.
 */
export function clientIp(req: Request): string | null {
  const socket = req.socket?.remoteAddress ?? '';
  if (!isTrustedProxy(socket)) return plain(socket) || null;
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first ? plain(first) : null;
}

import type { Request } from 'express';

process.env.TRUSTED_PROXIES = '10.0.0.5, 172.30.70.0/24';
const { clientIp, isTrustedProxy } = await import('./client-ip.js');

const req = (remoteAddress: string, forwarded?: string) => ({ socket: { remoteAddress }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} }) as unknown as Request;

describe('client address', () => {
  it('trusts this machine, listed addresses and ranges, in either IPv4 notation', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.5', '172.30.70.1', '::ffff:172.30.70.254']) expect(isTrustedProxy(a)).toBe(true);
    for (const a of ['10.0.0.6', '172.30.71.1', '172.30.69.255', '192.168.1.20', '::ffff:192.168.1.20', 'fe80::1']) expect(isTrustedProxy(a)).toBe(false);
  });

  it('believes X-Forwarded-For only from a trusted proxy', () => {
    expect(clientIp(req('::ffff:172.30.70.3', '192.168.1.20'))).toBe('192.168.1.20');
    expect(clientIp(req('::ffff:192.168.1.20', '1.2.3.4'))).toBe('192.168.1.20');
    expect(clientIp(req('172.30.70.3'))).toBeNull();
  });
});

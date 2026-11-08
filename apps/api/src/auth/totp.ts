/**
 * Time-based one-time codes (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30-second steps), the codes
 * shown by Google Authenticator, Microsoft Authenticator and similar apps. They need no network
 * or SMS, so they work at a clinic server with no internet.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one counter value (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Checks a 6-digit code against the steps around now (±1: a phone's clock may be a little off,
 * and a code typed at the end of its 30 seconds still counts). Steps up to `lastStep` were used
 * already and are refused, so a code seen over someone's shoulder can't be used again.
 * Returns the matching step, or null.
 */
export function verifyTotp(secretBase32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const secret = base32Decode(secretBase32);
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(typed))) return s;
  }
  return null;
}

/** A new 160-bit secret, base32 as the apps expect. */
export const newSecret = () => base32Encode(randomBytes(20));

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** One-time recovery codes for a lost phone, like "K7Q2-M9XD" (40 random bits each). */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const s = base32Encode(randomBytes(5));
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
}

/** Recovery codes are kept only as hashes; dashes, spaces and case don't matter when typed. */
export const hashRecoveryCode = (code: string) =>
  createHash('sha256')
    .update(code.toUpperCase().replace(/[^A-Z2-7]/g, ''))
    .digest('hex');

export const looksLikeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z2-7]/g, '').length === 8 && !/^\d+$/.test(code.trim());

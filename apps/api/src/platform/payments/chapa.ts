import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Chapa (chapa.co): card, Telebirr, CBE Birr, M-Pesa and bank payments through Chapa's hosted
 * checkout. Set CHAPA_SECRET_KEY to turn it on; CHAPA_WEBHOOK_SECRET if the webhook secret set in
 * the Chapa dashboard differs from the secret key. A payment counts only once Chapa's own verify
 * API says it succeeded: callbacks and webhooks just tell us when to ask.
 */
export function chapaConfig() {
  const secret = process.env.CHAPA_SECRET_KEY;
  if (!secret) return null;
  return {
    secret,
    apiUrl: (process.env.CHAPA_API_URL ?? 'https://api.chapa.co').replace(/\/+$/, ''),
    webhookSecret: process.env.CHAPA_WEBHOOK_SECRET || secret,
  };
}

export type ProviderResult = { status: 'paid' | 'failed' | 'pending'; amount: string | null; currency: string | null; providerReference: string | null; raw: unknown };

async function call(path: string, init: RequestInit = {}) {
  const cfg = chapaConfig();
  if (!cfg) throw new Error('Chapa is not configured');
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.secret}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

const message = (body: Record<string, unknown>) => (typeof body.message === 'string' ? body.message : JSON.stringify(body.message ?? body).slice(0, 300));

/** Starts a payment; returns the page to send the payer to. */
export async function chapaCheckout(input: {
  txRef: string;
  amount: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  callbackUrl: string;
  returnUrl: string;
  description: string;
}) {
  const { ok, body } = await call('/v1/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amount,
      currency: 'ETB',
      tx_ref: input.txRef,
      first_name: input.firstName,
      last_name: input.lastName,
      phone_number: input.phone,
      ...(input.email && { email: input.email }),
      callback_url: input.callbackUrl,
      return_url: input.returnUrl,
      // Chapa accepts only letters, digits, spaces, hyphens, underscores and dots here.
      customization: { title: 'HMIS', description: input.description.replace(/[^A-Za-z0-9 ._-]/g, ' ').slice(0, 50) },
    }),
  });
  const url = (body.data as { checkout_url?: string } | undefined)?.checkout_url;
  if (!ok || !url) throw new Error(`Chapa refused the payment: ${message(body)}`);
  return url;
}

/** Asks Chapa what happened to a payment. */
export async function chapaVerify(txRef: string): Promise<ProviderResult> {
  const { ok, status, body } = await call(`/v1/transaction/verify/${encodeURIComponent(txRef)}`);
  const data = (body.data ?? null) as { status?: string; amount?: number | string; currency?: string; reference?: string; tx_ref?: string } | null;
  // Not found yet, or a temporary problem at Chapa: ask again later.
  if (!ok || !data) return { status: status >= 500 || status === 404 ? 'pending' : 'failed', amount: null, currency: null, providerReference: null, raw: body };
  if (data.tx_ref && data.tx_ref !== txRef) return { status: 'failed', amount: null, currency: null, providerReference: null, raw: body };
  const s = String(data.status ?? '').toLowerCase();
  return {
    status: s === 'success' ? 'paid' : s === 'pending' ? 'pending' : 'failed',
    amount: data.amount === undefined || data.amount === null ? null : String(data.amount),
    currency: data.currency ?? null,
    providerReference: data.reference ?? null,
    raw: body,
  };
}

/**
 * Chapa signs each webhook with HMAC-SHA256 of the JSON body (x-chapa-signature). Only a signature
 * over the body counts: Chapa's other header (chapa-signature, the secret signed with itself) is
 * the same for every webhook, so it proves nothing about this one. Webhooks are only a hint
 * anyway: the payment is confirmed with Chapa's verify API.
 */
export function chapaWebhookValid(body: unknown, headers: Record<string, string | string[] | undefined>) {
  const cfg = chapaConfig();
  if (!cfg) return false;
  const expected = createHmac('sha256', cfg.webhookSecret).update(JSON.stringify(body)).digest('hex');
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const header = (name: string) => {
    const v = headers[name];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  return same(header('x-chapa-signature'), expected) || same(header('chapa-signature'), expected);
}

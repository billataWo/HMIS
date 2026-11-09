import { constants, randomBytes, sign as rsaSign, verify as rsaVerify } from 'node:crypto';
import type { ProviderResult } from './chapa.js';

/**
 * Telebirr H5 web checkout (Ethio Telecom), as in Telebirr's merchant integration guide:
 *   1. POST {api}/payment/v1/token            → a short-lived "fabric" token (X-APP-Key + appSecret)
 *   2. POST {api}/payment/v1/merchant/preOrder → prepay_id (a signed "payment.preorder")
 *   3. send the payer to {web}?<signed raw request>&version=1.0&trade_type=Checkout
 *   4. Telebirr calls our notify URL; we ask POST {api}/payment/v1/merchant/queryOrder ourselves.
 * Requests are signed SHA256WithRSA with RSA-PSS (the merchant's private key, registered with
 * Telebirr). A notification only makes us ask: a forged one cannot mark anything paid.
 *
 * Settings (all from the Telebirr merchant portal): TELEBIRR_API_URL, TELEBIRR_WEB_URL,
 * TELEBIRR_FABRIC_APP_ID, TELEBIRR_APP_SECRET, TELEBIRR_MERCHANT_APP_ID, TELEBIRR_MERCHANT_CODE,
 * TELEBIRR_PRIVATE_KEY (PEM), and optionally TELEBIRR_PUBLIC_KEY (Telebirr's, to check notifications).
 */
export function telebirrConfig() {
  const e = process.env;
  const need = [e.TELEBIRR_API_URL, e.TELEBIRR_WEB_URL, e.TELEBIRR_FABRIC_APP_ID, e.TELEBIRR_APP_SECRET, e.TELEBIRR_MERCHANT_APP_ID, e.TELEBIRR_MERCHANT_CODE, e.TELEBIRR_PRIVATE_KEY];
  if (need.some((v) => !v)) return null;
  const pem = (v: string) => v.replace(/\\n/g, '\n');
  return {
    apiUrl: e.TELEBIRR_API_URL!.replace(/\/+$/, ''),
    webUrl: e.TELEBIRR_WEB_URL!.replace(/[?&]+$/, ''),
    fabricAppId: e.TELEBIRR_FABRIC_APP_ID!,
    appSecret: e.TELEBIRR_APP_SECRET!,
    merchantAppId: e.TELEBIRR_MERCHANT_APP_ID!,
    merchantCode: e.TELEBIRR_MERCHANT_CODE!,
    privateKey: pem(e.TELEBIRR_PRIVATE_KEY!),
    publicKey: e.TELEBIRR_PUBLIC_KEY ? pem(e.TELEBIRR_PUBLIC_KEY) : null,
  };
}
type Config = NonNullable<ReturnType<typeof telebirrConfig>>;

/** Not signed: the signature itself, and nested or transport-only fields. */
const EXCLUDED = new Set(['sign', 'sign_type', 'header', 'refund_info', 'openType', 'raw_request', 'biz_content']);

/**
 * The text that is signed: every field of the request and of its biz_content (except the ones
 * above, and empty ones), as key=value, sorted by key, joined with &.
 */
export function signingString(request: Record<string, unknown>) {
  const fields: Record<string, string> = {};
  const add = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (EXCLUDED.has(k) || v === undefined || v === null || v === '' || typeof v === 'object') continue;
      fields[k] = String(v);
    }
  };
  add(request);
  if (request.biz_content && typeof request.biz_content === 'object') add(request.biz_content as Record<string, unknown>);
  return Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('&');
}

const PSS = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST };

export function telebirrSign(request: Record<string, unknown>, privateKey: string) {
  return rsaSign('sha256', Buffer.from(signingString(request)), { key: privateKey, ...PSS }).toString('base64');
}

export function telebirrVerify(payload: Record<string, unknown>, publicKey: string) {
  const sig = typeof payload.sign === 'string' ? payload.sign : '';
  if (!sig) return false;
  try {
    return rsaVerify('sha256', Buffer.from(signingString(payload)), { key: publicKey, ...PSS }, Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

const nonce = () => randomBytes(16).toString('hex');
const timestamp = () => String(Math.floor(Date.now() / 1000));

let token: { value: string; until: number } | null = null;

async function post(cfg: Config, path: string, body: unknown, auth = true): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-APP-Key': cfg.fabricAppId, ...(auth && { Authorization: await fabricToken(cfg) }) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function fabricToken(cfg: Config): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  const { ok, body } = await post(cfg, '/payment/v1/token', { appSecret: cfg.appSecret }, false);
  if (!ok || typeof body.token !== 'string') throw new Error(`Telebirr refused the access token: ${JSON.stringify(body).slice(0, 300)}`);
  // Tokens last about an hour; renew well before.
  token = { value: body.token, until: Date.now() + 30 * 60_000 };
  return token.value;
}

/** For tests: forget the cached access token. */
export function forgetTelebirrToken() {
  token = null;
}

const failed = (body: Record<string, unknown>) => body.result !== 'SUCCESS' && body.code !== '0' && body.code !== 0;

/** Creates the order and returns the Telebirr page to send the payer to. */
export async function telebirrCheckout(input: { merchOrderId: string; title: string; amount: string; notifyUrl: string; redirectUrl: string }) {
  const cfg = telebirrConfig();
  if (!cfg) throw new Error('Telebirr is not configured');
  const request: Record<string, unknown> = {
    timestamp: timestamp(),
    nonce_str: nonce(),
    method: 'payment.preorder',
    version: '1.0',
    biz_content: {
      notify_url: input.notifyUrl,
      appid: cfg.merchantAppId,
      merch_code: cfg.merchantCode,
      merch_order_id: input.merchOrderId,
      trade_type: 'Checkout',
      title: input.title.replace(/[^A-Za-z0-9 ._-]/g, ' ').slice(0, 60),
      total_amount: input.amount,
      trans_currency: 'ETB',
      timeout_express: '120m',
      business_type: 'BuyGoods',
      payee_identifier: cfg.merchantCode,
      payee_identifier_type: '04',
      payee_type: '5000',
      redirect_url: input.redirectUrl,
      callback_info: 'HMIS subscription',
    },
    sign_type: 'SHA256WithRSA',
  };
  request.sign = telebirrSign(request, cfg.privateKey);
  const { ok, body } = await post(cfg, '/payment/v1/merchant/preOrder', request);
  const prepayId = (body.biz_content as { prepay_id?: string } | undefined)?.prepay_id;
  if (!ok || failed(body) || !prepayId) throw new Error(`Telebirr refused the order: ${String(body.msg ?? body.errorMsg ?? JSON.stringify(body)).slice(0, 300)}`);

  const raw: Record<string, string> = { appid: cfg.merchantAppId, merch_code: cfg.merchantCode, nonce_str: nonce(), prepay_id: prepayId, timestamp: timestamp() };
  const signature = telebirrSign(raw, cfg.privateKey);
  const query = Object.entries(raw)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    // A base64 "+" would arrive as a space: the signature is sent URL-encoded.
    .concat([`sign=${encodeURIComponent(signature)}`, 'sign_type=SHA256WithRSA', 'version=1.0', 'trade_type=Checkout'])
    .join('&');
  return `${cfg.webUrl}${cfg.webUrl.includes('?') ? '&' : '?'}${query}`;
}

/** Asks Telebirr what happened to an order. */
export async function telebirrQuery(merchOrderId: string): Promise<ProviderResult> {
  const cfg = telebirrConfig();
  if (!cfg) throw new Error('Telebirr is not configured');
  const request: Record<string, unknown> = {
    timestamp: timestamp(),
    nonce_str: nonce(),
    method: 'payment.queryorder',
    version: '1.0',
    biz_content: { appid: cfg.merchantAppId, merch_code: cfg.merchantCode, merch_order_id: merchOrderId },
    sign_type: 'SHA256WithRSA',
  };
  request.sign = telebirrSign(request, cfg.privateKey);
  const { ok, body } = await post(cfg, '/payment/v1/merchant/queryOrder', request);
  const biz = body.biz_content as { order_status?: string; total_amount?: string | number; trans_currency?: string; payment_order_id?: string; trans_id?: string; merch_order_id?: string } | undefined;
  if (!ok || failed(body) || !biz) return { status: 'pending', amount: null, currency: null, providerReference: null, raw: body };
  if (biz.merch_order_id && biz.merch_order_id !== merchOrderId) return { status: 'failed', amount: null, currency: null, providerReference: null, raw: body };
  const s = String(biz.order_status ?? '').toUpperCase();
  return {
    status: s === 'PAY_SUCCESS' || s === 'COMPLETED' ? 'paid' : s === 'PAY_FAILED' || s === 'ORDER_CLOSED' || s === 'CANCELLED' ? 'failed' : 'pending',
    amount: biz.total_amount === undefined ? null : String(biz.total_amount),
    currency: biz.trans_currency ?? 'ETB',
    providerReference: biz.trans_id ?? biz.payment_order_id ?? null,
    raw: body,
  };
}

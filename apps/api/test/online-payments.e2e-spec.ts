import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { issueInvoice } from '../src/platform/billing.js';
import { forgetTelebirrToken, signingString, telebirrSign, telebirrVerify } from '../src/platform/payments/telebirr.js';
import { issueRenewalInvoices, reconcileCheckouts } from '../src/platform/payments/scheduler.js';
import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

const DAY = 86_400_000;
const merchant = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const telebirrKeys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

/** What the fake providers will answer about each reference. */
const chapa = new Map<string, { status: string; amount: string; currency?: string }>();
const telebirr = new Map<string, { order_status: string; total_amount: string }>();
const seen: { path: string; body: Record<string, unknown>; signatureOk?: boolean }[] = [];

/** A stand-in for Chapa's and Telebirr's APIs. Telebirr requests must carry a valid signature. */
function fakeProviders(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      const url = req.url ?? '';
      if (url === '/v1/transaction/initialize') {
        seen.push({ path: url, body });
        if (req.headers.authorization !== 'Bearer CHASECK_TEST-secret') return send(401, { message: 'Invalid API Key' });
        return send(200, { status: 'success', data: { checkout_url: `https://checkout.chapa.test/${body.tx_ref}` } });
      }
      if (url.startsWith('/v1/transaction/verify/')) {
        const ref = decodeURIComponent(url.split('/').pop()!);
        const t = chapa.get(ref);
        if (!t) return send(404, { message: 'Invalid transaction or Transaction not found', status: 'failed', data: null });
        return send(200, { message: 'Payment details', status: 'success', data: { tx_ref: ref, status: t.status, amount: t.amount, currency: t.currency ?? 'ETB', reference: `CH${ref.slice(-6)}` } });
      }
      if (url === '/payment/v1/token') {
        if (req.headers['x-app-key'] !== 'fabric-app' || body.appSecret !== 'app-secret') return send(401, { errorMsg: 'bad key' });
        return send(200, { token: 'Bearer fabric-token', effectiveDate: '20261109', expirationDate: '20261110' });
      }
      if (url.startsWith('/payment/v1/merchant/')) {
        const signatureOk = req.headers.authorization === 'Bearer fabric-token' && telebirrVerify(body, merchant.publicKey);
        seen.push({ path: url, body, signatureOk });
        if (!signatureOk) return send(400, { result: 'FAIL', code: '60000001', msg: 'Verify sign failed' });
        const biz = body.biz_content as Record<string, string>;
        if (url.endsWith('/preOrder')) return send(200, { result: 'SUCCESS', code: '0', biz_content: { merch_order_id: biz.merch_order_id, prepay_id: `PP${biz.merch_order_id.slice(-8)}` } });
        const o = telebirr.get(biz.merch_order_id) ?? { order_status: 'PAYING', total_amount: '0' };
        return send(200, { result: 'SUCCESS', code: '0', biz_content: { merch_order_id: biz.merch_order_id, ...o, trans_currency: 'ETB', trans_id: `TB${biz.merch_order_id.slice(-6)}` } });
      }
      send(404, {});
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

let providers: Server;
let admin: { id: string; token: string };
let tenantId: string;

beforeAll(async () => {
  providers = await fakeProviders();
  const base = `http://127.0.0.1:${(providers.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    HMIS_PLATFORM: '1',
    HMIS_SCHEDULER: '0',
    HMIS_PUBLIC_URL: 'https://cloud.hmis.test',
    CHAPA_SECRET_KEY: 'CHASECK_TEST-secret',
    CHAPA_WEBHOOK_SECRET: 'webhook-secret',
    CHAPA_API_URL: base,
    TELEBIRR_API_URL: base,
    TELEBIRR_WEB_URL: 'https://web.telebirr.test/wap/cashier/index',
    TELEBIRR_FABRIC_APP_ID: 'fabric-app',
    TELEBIRR_APP_SECRET: 'app-secret',
    TELEBIRR_MERCHANT_APP_ID: '1234567890',
    TELEBIRR_MERCHANT_CODE: '654321',
    TELEBIRR_PRIVATE_KEY: merchant.privateKey.replace(/\n/g, '\\n'), // as it is written in deploy/.env
    TELEBIRR_PUBLIC_KEY: telebirrKeys.publicKey,
  });
  forgetTelebirrToken();
  await startApp();
  tenantId = (await makeClinic('Online Payments Clinic')).id;
  const basic = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
  await db.subscription.create({ data: { tenantId, planId: basic.id, status: 'TRIAL', trialEndsAt: new Date(Date.now() + 5 * DAY) } });
  admin = await makeStaff(tenantId, 'ADMIN');
});
afterAll(async () => {
  await stopApp();
  providers.close();
});

/** A fresh open invoice for the clinic (voiding any open one). */
async function openInvoice() {
  await db.platformInvoice.updateMany({ where: { tenantId, status: 'OPEN' }, data: { status: 'VOID', voidReason: 'test' } });
  return issueInvoice(db, tenantId, null);
}
const checkout = (invoiceId: string, provider: 'CHAPA' | 'TELEBIRR') =>
  api.post(`/subscription/invoices/${invoiceId}/checkout`).set(bearer(admin.token)).send({ provider });
const check = (reference: string) => api.post(`/subscription/checkouts/${reference}/check`).set(bearer(admin.token));
const chapaSignature = (body: object) => createHmac('sha256', 'webhook-secret').update(JSON.stringify(body)).digest('hex');

describe('Telebirr request signing', () => {
  it('signs every field but the signature and nested ones, sorted, and verifies with the public key', () => {
    const request = { timestamp: '1700000000', nonce_str: 'abc', method: 'payment.preorder', version: '1.0', sign_type: 'SHA256WithRSA', biz_content: { title: 'X', appid: '1', empty: '' } };
    expect(signingString(request)).toBe('appid=1&method=payment.preorder&nonce_str=abc&timestamp=1700000000&title=X&version=1.0');
    const signed = { ...request, sign: telebirrSign(request, merchant.privateKey) };
    expect(telebirrVerify(signed, merchant.publicKey)).toBe(true);
    expect(telebirrVerify({ ...signed, timestamp: '1700000001' }, merchant.publicKey)).toBe(false);
    expect(telebirrVerify(signed, telebirrKeys.publicKey)).toBe(false);
  });
});

describe('paying a subscription online', () => {
  it('offers the configured methods', async () => {
    const s = (await api.get('/subscription').set(bearer(admin.token)).expect(200)).body;
    expect(s.online).toEqual({ CHAPA: true, TELEBIRR: true });
  });

  it('with Chapa: counts only once Chapa confirms it, and only once', async () => {
    const invoice = await openInvoice();
    const started = (await checkout(invoice.id, 'CHAPA').expect(201)).body;
    expect(started.url).toBe(`https://checkout.chapa.test/${started.reference}`);
    const sent = seen.findLast((s) => s.path === '/v1/transaction/initialize')!.body;
    expect(sent).toMatchObject({ amount: '2875.00', currency: 'ETB', tx_ref: started.reference, return_url: `https://cloud.hmis.test/settings/subscription/paid?ref=${started.reference}` });

    // Back from Chapa before it is done: nothing counts yet.
    chapa.set(started.reference, { status: 'pending', amount: '2875' });
    expect((await check(started.reference).expect(201)).body.status).toBe('CREATED');

    chapa.set(started.reference, { status: 'success', amount: '2875' });
    const done = (await check(started.reference).expect(201)).body;
    expect(done).toMatchObject({ status: 'PAID', applied: true, invoice: { status: 'PAID' } });
    const sub = await db.subscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.paidUntil!.getTime()).toBe(invoice.periodEnd.getTime());

    // The webhook and the callback arrive too: still one payment.
    const hook = { event: 'charge.success', tx_ref: started.reference, status: 'success' };
    await api.post('/public/payments/chapa/webhook').set('x-chapa-signature', chapaSignature(hook)).send(hook).expect(200);
    await api.get(`/public/payments/chapa/callback?trx_ref=${started.reference}&status=success`).expect(200);
    const payments = await db.platformPayment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: 'CHAPA', status: 'CONFIRMED', reference: started.reference });
  });

  it("refuses Chapa webhooks that aren't signed, and settles through signed ones", async () => {
    const invoice = await openInvoice();
    const { reference } = (await checkout(invoice.id, 'CHAPA').expect(201)).body;
    chapa.set(reference, { status: 'success', amount: '2875.00' });
    const hook = { event: 'charge.success', tx_ref: reference, status: 'success' };
    await api.post('/public/payments/chapa/webhook').send(hook).expect(401);
    await api.post('/public/payments/chapa/webhook').set('x-chapa-signature', chapaSignature({ ...hook, amount: 1 })).send(hook).expect(401);
    expect((await db.platformCheckout.findUniqueOrThrow({ where: { reference } })).status).toBe('CREATED');
    await api.post('/public/payments/chapa/webhook').set('x-chapa-signature', chapaSignature(hook)).send(hook).expect(200);
    expect((await db.platformCheckout.findUniqueOrThrow({ where: { reference } })).status).toBe('PAID');
  });

  it('counts what was really paid: less than the invoice leaves it open', async () => {
    const invoice = await openInvoice();
    const { reference } = (await checkout(invoice.id, 'CHAPA').expect(201)).body;
    chapa.set(reference, { status: 'success', amount: '1000' });
    expect((await check(reference).expect(201)).body).toMatchObject({ status: 'PAID', applied: true, invoice: { status: 'OPEN' } });
    // The next checkout asks only for the rest.
    await checkout(invoice.id, 'CHAPA').expect(201);
    expect(seen.findLast((s) => s.path === '/v1/transaction/initialize')!.body.amount).toBe('1875.00');
  });

  it('with Telebirr: a signed order, a signed checkout page, and a notification that only makes us ask', async () => {
    const invoice = await openInvoice();
    const started = (await checkout(invoice.id, 'TELEBIRR').expect(201)).body;
    const order = seen.findLast((s) => s.path === '/payment/v1/merchant/preOrder')!;
    expect(order.signatureOk).toBe(true);
    expect(order.body.biz_content).toMatchObject({ merch_order_id: started.reference, total_amount: '2875.00', trans_currency: 'ETB', notify_url: 'https://cloud.hmis.test/public/payments/telebirr/notify' });
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe('https://web.telebirr.test/wap/cashier/index');
    const raw = Object.fromEntries(url.searchParams);
    expect(raw).toMatchObject({ appid: '1234567890', merch_code: '654321', prepay_id: `PP${started.reference.slice(-8)}`, trade_type: 'Checkout', version: '1.0' });
    const { sign, sign_type: _t, version: _v, trade_type: _tt, ...signed } = raw;
    expect(telebirrVerify({ ...signed, sign }, merchant.publicKey)).toBe(true);

    const notice = (extra: object = {}) => {
      const n: Record<string, unknown> = { merch_order_id: started.reference, trade_status: 'Completed', total_amount: '2875.00', ...extra };
      return { ...n, sign_type: 'SHA256WithRSA', sign: telebirrSign(n, telebirrKeys.privateKey) };
    };
    // Not signed by Telebirr: refused.
    await api.post('/public/payments/telebirr/notify').send({ merch_order_id: started.reference, trade_status: 'Completed', sign: 'forged' }).expect(401);
    // Signed, but Telebirr's own records say it is not paid: nothing counts.
    await api.post('/public/payments/telebirr/notify').send(notice()).expect(200);
    expect((await db.platformCheckout.findUniqueOrThrow({ where: { reference: started.reference } })).status).toBe('CREATED');
    telebirr.set(started.reference, { order_status: 'PAY_SUCCESS', total_amount: '2875.00' });
    await api.post('/public/payments/telebirr/notify').send(notice()).expect(200);
    const done = await db.platformCheckout.findUniqueOrThrow({ where: { reference: started.reference } });
    expect(done.status).toBe('PAID');
    expect((await db.platformInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');
  });

  it('keeps money paid for an invoice that was voided meanwhile, for HMIS to sort out', async () => {
    const invoice = await openInvoice();
    const { reference } = (await checkout(invoice.id, 'CHAPA').expect(201)).body;
    await db.platformInvoice.update({ where: { id: invoice.id }, data: { status: 'VOID', voidReason: 'replaced' } });
    chapa.set(reference, { status: 'success', amount: '2875' });
    expect((await check(reference).expect(201)).body).toMatchObject({ status: 'PAID', applied: false });
    const c = await db.platformCheckout.findUniqueOrThrow({ where: { reference } });
    expect(c.paymentId).toBeNull();
    expect(c.lastError).toContain('not applied');
  });

  it("is refused when the provider isn't set up, and another clinic's checkout is invisible", async () => {
    const invoice = await openInvoice();
    const key = process.env.CHAPA_SECRET_KEY;
    delete process.env.CHAPA_SECRET_KEY;
    try {
      await checkout(invoice.id, 'CHAPA').expect(400);
    } finally {
      process.env.CHAPA_SECRET_KEY = key;
    }
    const { reference } = (await checkout(invoice.id, 'CHAPA').expect(201)).body;
    const other = (await makeClinic('Other Online Clinic')).id;
    const otherAdmin = await makeStaff(other, 'ADMIN');
    await api.post(`/subscription/checkouts/${reference}/check`).set(bearer(otherAdmin.token)).expect(404);
    await api.post(`/subscription/invoices/${invoice.id}/checkout`).set(bearer(otherAdmin.token)).send({ provider: 'CHAPA' }).expect(404);
  });

  it('is confirmed in the background when nobody came back from the payment page', async () => {
    const invoice = await openInvoice();
    const { reference } = (await checkout(invoice.id, 'CHAPA').expect(201)).body;
    chapa.set(reference, { status: 'success', amount: '2875' });
    await db.platformCheckout.update({ where: { reference }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    const stale = await db.platformCheckout.create({ data: { reference: `HMIS0000${randomUUID().slice(0, 8).toUpperCase()}`, provider: 'CHAPA', invoiceId: invoice.id, tenantId, amount: '1', createdAt: new Date(Date.now() - 2 * DAY) } });
    const result = await reconcileCheckouts(db);
    expect(result.paid).toBeGreaterThanOrEqual(1);
    expect((await db.platformCheckout.findUniqueOrThrow({ where: { reference } })).status).toBe('PAID');
    expect((await db.platformCheckout.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('EXPIRED');
  });
});

describe('renewal invoices', () => {
  async function clinicEnding(inDays: number, opts: { status?: 'TRIAL' | 'ACTIVE'; noEnd?: boolean } = {}) {
    const id = (await makeClinic(`Renewal ${randomUUID().slice(0, 6)}`)).id;
    const plan = await db.plan.findUniqueOrThrow({ where: { code: 'STANDARD' } });
    const end = opts.noEnd ? null : new Date(Date.now() + inDays * DAY);
    await db.subscription.create({ data: { tenantId: id, planId: plan.id, status: opts.status ?? 'ACTIVE', ...(opts.status === 'TRIAL' ? { trialEndsAt: end } : { paidUntil: end }) } });
    return id;
  }

  it('are issued before the end, once, and never for free clinics or ones HMIS voided', async () => {
    const soon = await clinicEnding(5);
    const trial = await clinicEnding(3, { status: 'TRIAL' });
    const later = await clinicEnding(40);
    const free = await clinicEnding(0, { noEnd: true });
    const voided = await clinicEnding(2);
    const v = await issueInvoice(db, voided, null);
    await db.platformInvoice.update({ where: { id: v.id }, data: { status: 'VOID' } });

    await issueRenewalInvoices(db);
    const count = (id: string) => db.platformInvoice.count({ where: { tenantId: id, status: 'OPEN' } });
    expect(await count(soon)).toBe(1);
    expect(await count(trial)).toBe(1);
    expect(await count(later)).toBe(0);
    expect(await count(free)).toBe(0);
    expect(await count(voided)).toBe(0);
    const inv = await db.platformInvoice.findFirstOrThrow({ where: { tenantId: soon } });
    const sub = await db.subscription.findUniqueOrThrow({ where: { tenantId: soon } });
    expect(inv.periodStart.getTime()).toBe(sub.paidUntil!.getTime());

    await issueRenewalInvoices(db);
    expect(await db.platformInvoice.count({ where: { tenantId: soon } })).toBe(1);

    await db.platformSetting.update({ where: { id: 1 }, data: { autoInvoice: false } });
    try {
      const off = await clinicEnding(1);
      await issueRenewalInvoices(db);
      expect(await count(off)).toBe(0);
    } finally {
      await db.platformSetting.update({ where: { id: 1 }, data: { autoInvoice: true } });
    }
  });
});

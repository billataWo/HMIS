import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PlatformRole } from '@hmis/db';
import { base32Decode, currentStep, hotp, newSecret } from '../src/auth/totp.js';
import { forgetSubscription } from '../src/platform/subscription.guard.js';
import { api, bearer, db, login, makeClinic, makeStaff, phone, startApp, stopApp } from './helpers.js';

process.env.HMIS_PLATFORM = '1';
process.env.HMIS_SCHEDULER = '0';
beforeAll(startApp);
afterAll(stopApp);

const DAY = 86_400_000;
const PASSWORD = 'operator-password-1';

async function makeOperator(role: PlatformRole = 'OWNER', opts: { twoStep?: boolean } = {}) {
  return db.platformUser.create({
    data: {
      fullName: `${role} operator`,
      email: `op-${randomUUID()}@hmis.test`,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      mustChangePassword: false,
      ...(opts.twoStep !== false && { totpSecret: newSecret(), totpEnabledAt: new Date() }),
    },
  });
}

/** What the operator's authenticator app shows now (each code works once). */
async function opCode(id: string) {
  for (;;) {
    const op = await db.platformUser.findUniqueOrThrow({ where: { id } });
    const now = currentStep();
    const step = Math.max(now - 1, (op.totpLastStep ?? -Infinity) + 1);
    if (step <= now + 1) return hotp(base32Decode(op.totpSecret!), step);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function opLogin(op: { id: string; email: string }) {
  const first = await api.post('/platform/auth/login').send({ email: op.email, password: PASSWORD }).expect(200);
  if (first.body.token) return first.body.token as string;
  const second = await api.post('/platform/auth/login/two-step').send({ challenge: first.body.challenge, code: await opCode(op.id) }).expect(200);
  return second.body.token as string;
}

let ip = 0;
const from = () => ({ 'X-Forwarded-For': `10.9.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}` });

function requestBody(extra: object = {}) {
  return {
    clinicName: `Request Clinic ${randomUUID().slice(0, 8)}`,
    region: 'Amhara',
    city: 'Bahir Dar',
    contactName: 'Dr. Almaz Tesfaye',
    contactPhone: phone(),
    planCode: 'BASIC',
    staffCount: 4,
    termsVersion: '2026-11-12',
    ...extra,
  };
}

describe('the HMIS platform (SaaS)', () => {
  let owner: { id: string; email: string };
  let ownerToken: string;

  beforeAll(async () => {
    owner = await makeOperator('OWNER');
    ownerToken = await opLogin(owner);
  });

  it('exists only on the HMIS cloud', async () => {
    process.env.HMIS_PLATFORM = '0';
    try {
      await api.get('/public/plans').expect(404);
      await api.get('/platform/overview').set(bearer(ownerToken)).expect(404);
      await api.post('/platform/auth/login').send({ email: owner.email, password: PASSWORD }).expect(404);
    } finally {
      process.env.HMIS_PLATFORM = '1';
    }
  });

  describe('requests from clinics', () => {
    it('shows the plans and takes a request', async () => {
      const plans = (await api.get('/public/plans').expect(200)).body;
      expect(plans.plans.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['BASIC', 'STANDARD', 'HOSPITAL']));
      expect(plans.trialDays).toBe(30);

      const body = requestBody({ contactPhone: '+251 911 55 66 77' });
      const { reference } = (await api.post('/public/clinic-requests').set(from()).send(body).expect(201)).body;
      expect(reference).toMatch(/^R-[0-9A-F]{6}$/);
      const saved = await db.clinicRequest.findUniqueOrThrow({ where: { reference } });
      expect(saved).toMatchObject({ status: 'PENDING', contactPhone: '0911556677', clinicName: body.clinicName, termsVersion: '2026-11-12' });
      expect(saved.termsAcceptedAt).toBeInstanceOf(Date);
      // The terms and the privacy policy must be accepted.
      await api.post('/public/clinic-requests').set(from()).send(requestBody({ termsVersion: undefined })).expect(400);
      await api.post('/public/clinic-requests').set(from()).send(requestBody({ termsVersion: 'yes' })).expect(400);
    });

    it('refuses a phone that is not Ethiopian, ignores robots, and limits each address', async () => {
      await api.post('/public/clinic-requests').set(from()).send(requestBody({ contactPhone: '12345678901' })).expect(400);
      const robot = requestBody({ website: 'http://spam.example' });
      const { reference } = (await api.post('/public/clinic-requests').set(from()).send(robot).expect(201)).body;
      expect(await db.clinicRequest.findUnique({ where: { reference } })).toBeNull();

      const same = from();
      for (let i = 0; i < 5; i++) await api.post('/public/clinic-requests').set(same).send(requestBody()).expect(201);
      await api.post('/public/clinic-requests').set(same).send(requestBody()).expect(429);
    });
  });

  describe('operators', () => {
    it('are separate from clinic staff: neither sign-in works on the other side', async () => {
      const tenantId = (await makeClinic('Separation Clinic')).id;
      const admin = await makeStaff(tenantId, 'ADMIN');
      await api.get('/platform/overview').set(bearer(admin.token)).expect(401);
      await api.get('/patients').set(bearer(ownerToken)).expect(401);
    });

    it('limits wrong current passwords, so a stolen session cannot guess the password', async () => {
      const op = await makeOperator('SUPPORT');
      const token = await opLogin(op);
      for (let i = 0; i < 5; i++) {
        await api.post('/platform/auth/password').set(bearer(token)).send({ current: `wrong-${i}`, next: 'another-long-password' }).expect(409);
      }
      // Now even the right one waits, and so does moving two-step sign-in to another phone.
      await api.post('/platform/auth/password').set(bearer(token)).send({ current: PASSWORD, next: 'another-long-password' }).expect(429);
      await api.post('/platform/auth/two-step/setup').set(bearer(token)).send({ password: PASSWORD }).expect(429);
      expect(await db.platformAuditLog.count({ where: { operatorId: op.id, action: 'platform.password_check_failed' } })).toBe(5);
    });

    it('must change the temporary password and set up two-step sign-in first', async () => {
      const op = await makeOperator('SUPPORT', { twoStep: false });
      await db.platformUser.update({ where: { id: op.id }, data: { mustChangePassword: true } });
      let token = (await api.post('/platform/auth/login').send({ email: op.email, password: PASSWORD }).expect(200)).body.token;
      expect((await api.get('/platform/overview').set(bearer(token)).expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await api.post('/platform/auth/password').set(bearer(token)).send({ current: PASSWORD, next: 'short' }).expect(400);
      token = (await api.post('/platform/auth/password').set(bearer(token)).send({ current: PASSWORD, next: 'a-much-longer-password' }).expect(200)).body.token;
      expect((await api.get('/platform/overview').set(bearer(token)).expect(403)).body.code).toBe('TWO_STEP_SETUP_REQUIRED');

      const { secret } = (await api.post('/platform/auth/two-step/setup').set(bearer(token)).send({}).expect(200)).body;
      const code = hotp(base32Decode(secret), currentStep());
      // Sign-in times count in whole seconds: let the current session be from an earlier one.
      await new Promise((r) => setTimeout(r, 1100));
      const enabled = (await api.post('/platform/auth/two-step/enable').set(bearer(token)).send({ code }).expect(200)).body;
      expect(enabled.recoveryCodes).toHaveLength(10);
      await api.get('/platform/overview').set(bearer(token)).expect(401); // sessions from before ended
      await api.get('/platform/overview').set(bearer(enabled.token)).expect(200);

      // From now on the password alone is not enough.
      const again = (await api.post('/platform/auth/login').send({ email: op.email, password: 'a-much-longer-password' }).expect(200)).body;
      expect(again.token).toBeUndefined();
      expect(again.twoStepRequired).toBe(true);
      await api.post('/platform/auth/login/two-step').send({ challenge: again.challenge, code: '000000' }).expect(401);
      await api.post('/platform/auth/login/two-step').send({ challenge: again.challenge, code: enabled.recoveryCodes[0] }).expect(200);
      await api.post('/platform/auth/login/two-step').send({ challenge: again.challenge, code: enabled.recoveryCodes[0] }).expect(401); // used once
    });

    it('are limited by role', async () => {
      const support = await makeOperator('SUPPORT');
      const token = await opLogin(support);
      await api.get('/platform/clinics').set(bearer(token)).expect(200);
      await api.patch(`/platform/plans/${randomUUID()}`).set(bearer(token)).send({ name: 'Nope' }).expect(403);
      await api.get('/platform/operators').set(bearer(token)).expect(403);
      await api.patch('/platform/settings').set(bearer(token)).send({ trialDays: 1 }).expect(403);
    });
  });

  describe('a clinic from request to paying customer', () => {
    let requestId: string;
    let tenantId: string;
    let adminToken: string;

    it('is created, with a trial, when its request is approved', async () => {
      const body = requestBody({ clinicNameAm: 'ሙከራ ክሊኒክ' });
      const { reference } = (await api.post('/public/clinic-requests').set(from()).send(body).expect(201)).body;
      requestId = (await db.clinicRequest.findUniqueOrThrow({ where: { reference } })).id;

      const approved = (await api.post(`/platform/requests/${requestId}/approve`).set(bearer(ownerToken)).send({ planCode: 'BASIC', trialDays: 30 }).expect(200)).body;
      expect(approved.temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
      tenantId = approved.tenantId;
      await api.post(`/platform/requests/${requestId}/approve`).set(bearer(ownerToken)).send({ planCode: 'BASIC' }).expect(409);

      const sub = await db.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } });
      expect(sub).toMatchObject({ status: 'TRIAL', deployment: 'CLOUD', plan: { code: 'BASIC' } });
      expect(Math.round((sub.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(30);
      expect(await db.serviceItem.count({ where: { tenantId } })).toBeGreaterThan(0); // starter price list

      // The admin signs in with the temporary password, chooses a new one, then sets up two-step.
      const first = (await api.post('/auth/login').send({ phone: approved.adminPhone, password: approved.temporaryPassword }).expect(200)).body;
      expect(first.mustChangePassword ?? first.user?.mustChangePassword ?? true).toBeTruthy();
      const admin = await db.user.findFirstOrThrow({ where: { tenantId, role: 'ADMIN' } });
      await db.user.update({ where: { id: admin.id }, data: { mustChangePassword: false, totpSecret: newSecret(), totpEnabledAt: new Date(), passwordHash: await bcrypt.hash('password123', 4) } });
      adminToken = await login(approved.adminPhone);
      const me = (await api.get('/auth/me').set(bearer(adminToken)).expect(200)).body;
      expect(me.subscription).toMatchObject({ state: 'trial', readOnly: false, planName: 'Basic' });
      expect(me.features).toEqual([]);
    });

    it('stays within its plan: modules and staff accounts', async () => {
      const payer = { name: 'Ethio Insurance', type: 'INSURANCE' };
      expect((await api.post('/payers').set(bearer(adminToken)).send(payer).expect(403)).body.code).toBe('FEATURE_NOT_IN_PLAN');
      await api.get('/payers').set(bearer(adminToken)).expect(200); // looking is fine

      // Basic: 5 active staff accounts, the admin is the first.
      for (let i = 0; i < 4; i++) {
        await api.post('/users').set(bearer(adminToken)).send({ fullName: `Staff ${i}`, phone: phone(), role: 'NURSE', password: 'password123' }).expect(201);
      }
      const extra = await api.post('/users').set(bearer(adminToken)).send({ fullName: 'One too many', phone: phone(), role: 'NURSE', password: 'password123' }).expect(403);
      expect(extra.body.code).toBe('STAFF_LIMIT');

      // A bigger plan lifts both at once.
      const standard = await db.plan.findUniqueOrThrow({ where: { code: 'STANDARD' } });
      await api.patch(`/platform/clinics/${tenantId}/subscription`).set(bearer(ownerToken)).send({ planId: standard.id }).expect(200);
      await api.post('/users').set(bearer(adminToken)).send({ fullName: 'Now allowed', phone: phone(), role: 'NURSE', password: 'password123' }).expect(201);
    });

    it('gets an invoice for the period after the trial, with VAT', async () => {
      const invoice = (await api.post(`/platform/clinics/${tenantId}/invoices`).set(bearer(ownerToken)).expect(201)).body;
      expect(invoice).toMatchObject({ planName: 'Standard', cycle: 'MONTHLY', subtotal: '5000', vat: '750', total: '5750', status: 'OPEN' });
      expect(invoice.number).toMatch(/^HMIS-\d{4}-\d{5}$/);
      const sub = await db.subscription.findUniqueOrThrow({ where: { tenantId } });
      expect(new Date(invoice.periodStart).getTime()).toBe(sub.trialEndsAt!.getTime());
      await api.post(`/platform/clinics/${tenantId}/invoices`).set(bearer(ownerToken)).expect(409); // one open at a time

      const mine = (await api.get('/subscription').set(bearer(adminToken)).expect(200)).body;
      expect(mine).toMatchObject({ managed: true, state: 'trial', activeStaff: 6, plan: { code: 'STANDARD', maxStaff: 15 } });
      expect(mine.invoices[0]).toMatchObject({ number: invoice.number, paid: '0.00' });
    });

    it('pays by bank transfer: reported by the clinic, confirmed by HMIS', async () => {
      const invoice = await db.platformInvoice.findFirstOrThrow({ where: { tenantId, status: 'OPEN' } });
      const reference = `FT${Date.now()}`;
      const reported = (await api.post(`/subscription/invoices/${invoice.id}/bank-transfer`).set(bearer(adminToken)).send({ reference, amount: '5750', paidAt: new Date().toISOString() }).expect(201)).body;
      expect(reported.status).toBe('PENDING');
      await api.post(`/subscription/invoices/${invoice.id}/bank-transfer`).set(bearer(adminToken)).send({ reference, amount: '5750', paidAt: new Date().toISOString() }).expect(409);

      const overview = (await api.get('/platform/overview').set(bearer(ownerToken)).expect(200)).body;
      expect(overview.pendingPayments.some((p: { id: string }) => p.id === reported.id)).toBe(true);

      const confirmed = (await api.post(`/platform/payments/${reported.id}/confirm`).set(bearer(ownerToken)).expect(200)).body;
      expect(confirmed.paidInFull).toBe(true);
      const sub = await db.subscription.findUniqueOrThrow({ where: { tenantId } });
      expect(sub.status).toBe('ACTIVE');
      expect(sub.paidUntil!.getTime()).toBe(invoice.periodEnd.getTime());
      expect((await db.platformInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');
      await api.post(`/platform/payments/${reported.id}/confirm`).set(bearer(ownerToken)).expect(409);
    });

    it('counts part payments recorded by HMIS until the invoice is paid', async () => {
      const invoice = (await api.post(`/platform/clinics/${tenantId}/invoices`).set(bearer(ownerToken)).expect(201)).body;
      const before = await db.subscription.findUniqueOrThrow({ where: { tenantId } });
      expect(new Date(invoice.periodStart).getTime()).toBe(before.paidUntil!.getTime()); // follows on
      const part = (await api.post(`/platform/invoices/${invoice.id}/payments`).set(bearer(ownerToken)).send({ amount: '3000', method: 'CASH', paidAt: new Date().toISOString() }).expect(201)).body;
      expect(part.paidInFull).toBe(false);
      const rest = (await api.post(`/platform/invoices/${invoice.id}/payments`).set(bearer(ownerToken)).send({ amount: '2750', method: 'CASH', paidAt: new Date().toISOString() }).expect(201)).body;
      expect(rest.paidInFull).toBe(true);
      expect((await db.subscription.findUniqueOrThrow({ where: { tenantId } })).paidUntil!.getTime()).toBe(new Date(invoice.periodEnd).getTime());
      await api.post(`/platform/invoices/${invoice.id}/payments`).set(bearer(ownerToken)).send({ amount: '1', method: 'CASH', paidAt: new Date().toISOString() }).expect(409);
    });

    it('becomes overdue after the end, then read-only after the grace period, until paid', async () => {
      const at = (paidUntil: Date) => db.subscription.update({ where: { tenantId }, data: { paidUntil } }).then(() => forgetSubscription(tenantId));
      const visitBody = { name: 'Anything' };

      await at(new Date(Date.now() - 3 * DAY)); // 3 days late: within 14 days' grace
      let me = (await api.get('/auth/me').set(bearer(adminToken)).expect(200)).body;
      expect(me.subscription).toMatchObject({ state: 'overdue', readOnly: false, daysLeft: 11 });
      await api.post('/displays').set(bearer(adminToken)).send(visitBody).expect(201);

      await at(new Date(Date.now() - 20 * DAY)); // past the grace period
      me = (await api.get('/auth/me').set(bearer(adminToken)).expect(200)).body;
      expect(me.subscription).toMatchObject({ state: 'suspended', readOnly: true });
      const refused = await api.post('/displays').set(bearer(adminToken)).send(visitBody).expect(402);
      expect(refused.body.code).toBe('SUBSCRIPTION_SUSPENDED');
      await api.get('/patients').set(bearer(adminToken)).expect(200); // looking things up still works
      await api.get('/subscription').set(bearer(adminToken)).expect(200);
      // Paying is possible while suspended.
      const invoice = (await api.post(`/platform/clinics/${tenantId}/invoices`).set(bearer(ownerToken)).expect(201)).body;
      expect(new Date(invoice.periodStart).getTime()).toBeGreaterThan(Date.now() - 60_000); // read-only weeks are not charged
      await api.post(`/subscription/invoices/${invoice.id}/bank-transfer`).set(bearer(adminToken)).send({ reference: `FT-late-${Date.now()}`, amount: invoice.total, paidAt: new Date().toISOString() }).expect(201);
      const pending = await db.platformPayment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      await api.post(`/platform/payments/${pending.id}/confirm`).set(bearer(ownerToken)).expect(200);
      me = (await api.get('/auth/me').set(bearer(adminToken)).expect(200)).body;
      expect(me.subscription).toMatchObject({ state: 'active', readOnly: false });
      await api.post('/displays').set(bearer(adminToken)).send(visitBody).expect(201);
    });

    it('can be suspended and reactivated by HMIS, and cancelled', async () => {
      await api.post(`/platform/clinics/${tenantId}/suspend`).set(bearer(ownerToken)).send({ reason: 'Disputed payment' }).expect(200);
      await api.post('/displays').set(bearer(adminToken)).send({ name: 'TV' }).expect(402);
      await api.post(`/platform/clinics/${tenantId}/reactivate`).set(bearer(ownerToken)).expect(200);
      await api.post('/displays').set(bearer(adminToken)).send({ name: 'TV' }).expect(201);

      const detail = (await api.get(`/platform/clinics/${tenantId}`).set(bearer(ownerToken)).expect(200)).body;
      expect(detail.request.id).toBe(requestId);
      expect(detail.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['request.approved', 'subscription.suspended', 'subscription.reactivated', 'payment.confirmed']));

      await api.post(`/platform/clinics/${tenantId}/cancel`).set(bearer(ownerToken)).send({ reason: 'Clinic closed' }).expect(200);
      const me = (await api.get('/auth/me').set(bearer(adminToken)).expect(200)).body;
      expect(me.subscription).toMatchObject({ state: 'cancelled', readOnly: true });
    });

    it("shows a clinic only its own HMIS invoices", async () => {
      const other = (await makeClinic('Other SaaS Clinic')).id;
      const basic = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
      await db.subscription.create({ data: { tenantId: other, planId: basic.id, status: 'TRIAL', trialEndsAt: new Date(Date.now() + DAY) } });
      const otherAdmin = await makeStaff(other, 'ADMIN');
      const mine = (await api.get('/subscription').set(bearer(otherAdmin.token)).expect(200)).body;
      expect(mine.invoices).toEqual([]);
      const theirs = await db.platformInvoice.findFirstOrThrow({ where: { tenantId } });
      await api.post(`/subscription/invoices/${theirs.id}/bank-transfer`).set(bearer(otherAdmin.token)).send({ reference: 'FT-sneaky-1', amount: '1', paidAt: new Date().toISOString() }).expect(404);
    });

    it('leaves clinics without a subscription alone', async () => {
      const free = (await makeClinic('Unmanaged Clinic')).id;
      const admin = await makeStaff(free, 'ADMIN');
      const me = (await api.get('/auth/me').set(bearer(admin.token)).expect(200)).body;
      expect(me.subscription).toBeNull();
      expect(me.features).toBeNull();
      expect((await api.get('/subscription').set(bearer(admin.token)).expect(200)).body).toEqual({ managed: false });
      await api.post('/payers').set(bearer(admin.token)).send({ name: 'Any Insurer', type: 'INSURANCE' }).expect(201);
    });
  });
});

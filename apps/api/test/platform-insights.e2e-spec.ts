import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PlatformRole } from '@hmis/db';
import { base32Decode, currentStep, hotp, newSecret } from '../src/auth/totp.js';
import { clinicDay } from '../src/common/clinic-day.js';
import { toCents } from '../src/common/money.js';
import { ageBucket, daysLate } from '../src/platform/revenue.js';
import { api, bearer, db, makeClinic, makeUser, startApp, stopApp } from './helpers.js';

process.env.HMIS_PLATFORM = '1';
process.env.HMIS_SCHEDULER = '0';
beforeAll(startApp);
afterAll(stopApp);

const DAY = 86_400_000;
const PASSWORD = 'operator-password-1';

async function operator(role: PlatformRole) {
  const op = await db.platformUser.create({
    data: {
      fullName: `${role} insights`,
      email: `ins-${randomUUID()}@hmis.test`,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      mustChangePassword: false,
      totpSecret: newSecret(),
      totpEnabledAt: new Date(),
    },
  });
  const first = await api.post('/platform/auth/login').send({ email: op.email, password: PASSWORD }).expect(200);
  const code = hotp(base32Decode(op.totpSecret!), currentStep());
  const second = await api.post('/platform/auth/login/two-step').send({ challenge: first.body.challenge, code }).expect(200);
  return second.body.token as string;
}

/**
 * A paying clinic on BASIC (monthly, paid for 20 more days) with an invoice 10 days past its due
 * date: 1,000 ETB, of which 400 was paid by bank transfer today.
 */
async function payingClinic() {
  const name = `Insight Clinic ${randomUUID().slice(0, 8)}`;
  const tenant = await makeClinic(name);
  const basic = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
  const sub = await db.subscription.create({
    data: { tenantId: tenant.id, planId: basic.id, status: 'ACTIVE', billingCycle: 'MONTHLY', paidUntil: new Date(Date.now() + 20 * DAY) },
  });
  const invoice = await db.platformInvoice.create({
    data: {
      number: `TEST-INS-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      subscriptionId: sub.id,
      planName: basic.name,
      cycle: 'MONTHLY',
      periodStart: new Date(Date.now() - 15 * DAY),
      periodEnd: new Date(Date.now() + 15 * DAY),
      subtotal: '869.57',
      vat: '130.43',
      total: '1000.00',
      dueDate: new Date(Date.now() - 10 * DAY),
    },
  });
  const reference = `FT${randomUUID().slice(0, 10).toUpperCase()}`;
  const payment = await db.platformPayment.create({
    data: { invoiceId: invoice.id, tenantId: tenant.id, amount: '400.00', method: 'BANK_TRANSFER', status: 'CONFIRMED', reference, paidAt: new Date() },
  });
  return { tenant, name, basic, sub, invoice, payment, reference };
}

describe('the platform console: numbers, ledgers and search', () => {
  let owner: string;
  let support: string;

  beforeAll(async () => {
    owner = await operator('OWNER');
    support = await operator('SUPPORT');
  });

  it('metrics: revenue lost counts only clinics that were paying, not lapsed trials', async () => {
    const before = (await api.get('/platform/metrics').set(bearer(owner)).expect(200)).body;
    const basic = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
    const trial = await makeClinic(`Lapsed trial ${randomUUID().slice(0, 8)}`);
    await db.subscription.create({ data: { tenantId: trial.id, planId: basic.id, status: 'CANCELLED', trialEndsAt: new Date(Date.now() - 5 * DAY), cancelledAt: new Date() } });
    const paid = await makeClinic(`Left paying ${randomUUID().slice(0, 8)}`);
    await db.subscription.create({ data: { tenantId: paid.id, planId: basic.id, status: 'CANCELLED', paidUntil: new Date(Date.now() - 2 * DAY), cancelledAt: new Date() } });
    const after = (await api.get('/platform/metrics').set(bearer(owner)).expect(200)).body;
    expect(after.churn.cancelled - before.churn.cancelled).toBe(2);
    expect(toCents(after.churn.lostMrr) - toCents(before.churn.lostMrr)).toBe(toCents(basic.priceMonthly));
  });

  it('metrics: recurring revenue, money collected this month, and what is owed by how late', async () => {
    const before = (await api.get('/platform/metrics').set(bearer(owner)).expect(200)).body;
    const c = await payingClinic();
    const after = (await api.get('/platform/metrics').set(bearer(support)).expect(200)).body;

    expect(toCents(after.mrr) - toCents(before.mrr)).toBe(toCents(c.basic.priceMonthly));
    expect(toCents(after.arr)).toBe(toCents(after.mrr) * 12);
    expect(after.paying - before.paying).toBe(1);
    expect(toCents(after.collectedThisMonth) - toCents(before.collectedThisMonth)).toBe(40_000);
    expect(after.months).toHaveLength(12);
    expect(after.months[11].month).toBe(clinicDay().slice(0, 7));
    expect(toCents(after.receivables.ageing.d1_30.amount) - toCents(before.receivables.ageing.d1_30.amount)).toBe(60_000);
    expect(after.receivables.ageing.d1_30.count - before.receivables.ageing.d1_30.count).toBe(1);
    expect(after.byPlan.find((p: { code: string }) => p.code === 'BASIC')).toBeTruthy();
    expect(after.byMethod.find((m: { method: string }) => m.method === 'BANK_TRANSFER')).toBeTruthy();
  });

  it('an invoice is late from the day after it is due, in Addis Ababa calendar days', () => {
    const due = new Date('2026-11-09T21:00:00Z'); // 10 Nov, 00:00 in Addis Ababa
    expect(daysLate(due, new Date('2026-11-10T20:59:00Z'))).toBe(0); // 10 Nov, 23:59: due today
    expect(ageBucket(due, new Date('2026-11-10T20:59:00Z'))).toBe('current');
    expect(daysLate(due, new Date('2026-11-10T21:00:00Z'))).toBe(1); // 11 Nov, 00:00
    expect(ageBucket(due, new Date('2026-12-10T21:00:00Z'))).toBe('d31_60'); // 31 days
    expect(ageBucket(due, new Date('2027-02-09T21:00:00Z'))).toBe('d90_plus');
    expect(daysLate(due, new Date('2026-11-01T00:00:00Z'))).toBe(0); // not yet due
  });

  it('invoices across clinics: the balance, how late, filtered by status and found by clinic or number', async () => {
    const c = await payingClinic();
    const overdue = (await api.get(`/platform/invoices?status=OVERDUE&q=${encodeURIComponent(c.name)}`).set(bearer(owner)).expect(200)).body;
    expect(overdue.invoices).toHaveLength(1);
    expect(overdue.invoices[0]).toMatchObject({ number: c.invoice.number, clinic: c.name, paid: '400.00', balance: '600.00', daysLate: 10 });
    expect(overdue.summary.OVERDUE.count).toBeGreaterThanOrEqual(1);

    const byNumber = (await api.get(`/platform/invoices?q=${c.invoice.number.toLowerCase()}`).set(bearer(owner)).expect(200)).body;
    expect(byNumber.invoices.map((i: { id: string }) => i.id)).toEqual([c.invoice.id]);
    const paid = (await api.get(`/platform/invoices?status=PAID&q=${encodeURIComponent(c.name)}`).set(bearer(owner)).expect(200)).body;
    expect(paid.invoices).toHaveLength(0);
    // The counts on the status filters follow the search: this clinic has one open, overdue invoice.
    expect(paid.summary).toEqual({ OPEN: { count: 1, total: '1000' }, OVERDUE: { count: 1 } });
  });

  it('one invoice, ready to print: the seller (with TIN) from the settings, the clinic, payments and balance', async () => {
    const c = await payingClinic();
    await db.tenant.update({ where: { id: c.tenant.id }, data: { tin: '0012345678', address: 'Bahir Dar' } });
    await api.patch('/platform/settings').set(bearer(owner)).send({ companyName: 'HMIS Technologies PLC', companyTin: '0098765432', companyAddress: 'Addis Ababa' }).expect(200);
    try {
      const doc = (await api.get(`/platform/invoices/${c.invoice.id}`).set(bearer(support)).expect(200)).body;
      expect(doc.issuer).toMatchObject({ companyName: 'HMIS Technologies PLC', companyTin: '0098765432', companyAddress: 'Addis Ababa' });
      expect(doc.clinic).toMatchObject({ name: c.name, tin: '0012345678', address: 'Bahir Dar' });
      expect(doc.invoice).toMatchObject({ number: c.invoice.number, paid: '400.00', balance: '600.00', deployment: 'CLOUD' });
      expect(doc.invoice.payments).toHaveLength(1);
      // Only owners change the settings.
      await api.patch('/platform/settings').set(bearer(support)).send({ companyName: 'Not me' }).expect(403);
    } finally {
      await api.patch('/platform/settings').set(bearer(owner)).send({ companyName: null, companyTin: null, companyAddress: null }).expect(200);
    }
    await api.get('/platform/invoices/not-an-id').set(bearer(owner)).expect(404);
    await api.get(`/platform/invoices/${randomUUID()}`).set(bearer(owner)).expect(404);
  });

  it('payments across clinics: by day, method and reference', async () => {
    const c = await payingClinic();
    const today = clinicDay();
    const q = encodeURIComponent(c.name);
    const found = (await api.get(`/platform/payments?from=${today}&to=${today}&method=BANK_TRANSFER&q=${q}`).set(bearer(owner)).expect(200)).body;
    expect(found.payments).toHaveLength(1);
    expect(found.payments[0]).toMatchObject({ reference: c.reference, clinic: c.name, invoice: { number: c.invoice.number } });
    expect(found.payments[0]).not.toHaveProperty('provider');
    expect(found.summary).toMatchObject({ count: 1, confirmed: '400.00', pending: 0 });

    expect((await api.get(`/platform/payments?method=CASH&q=${q}`).set(bearer(owner)).expect(200)).body.payments).toHaveLength(0);
    const yesterday = clinicDay(new Date(Date.now() - DAY));
    expect((await api.get(`/platform/payments?to=${yesterday}&q=${q}`).set(bearer(owner)).expect(200)).body.payments).toHaveLength(0);
    expect((await api.get(`/platform/payments?q=${c.reference}`).set(bearer(owner)).expect(200)).body.payments).toHaveLength(1);
  });

  it('search: a clinic by its admin phone, an invoice by number, a payment by bank reference', async () => {
    const c = await payingClinic();
    const admin = await makeUser(c.tenant.id, 'ADMIN');
    const byPhone = (await api.get(`/platform/search?q=${admin.phone}`).set(bearer(support)).expect(200)).body;
    expect(byPhone.clinics.map((x: { id: string }) => x.id)).toContain(c.tenant.id);
    expect(byPhone.clinics.find((x: { id: string }) => x.id === c.tenant.id).state).toBe('active');

    const byNumber = (await api.get(`/platform/search?q=${c.invoice.number}`).set(bearer(support)).expect(200)).body;
    expect(byNumber.invoices).toEqual([expect.objectContaining({ id: c.invoice.id, clinic: c.name })]);
    const byRef = (await api.get(`/platform/search?q=${c.reference}`).set(bearer(support)).expect(200)).body;
    expect(byRef.payments).toEqual([expect.objectContaining({ id: c.payment.id, clinic: c.name })]);
    // Too short to mean anything: nothing, without asking the database.
    expect((await api.get('/platform/search?q=a').set(bearer(support)).expect(200)).body).toEqual({ clinics: [], invoices: [], requests: [], payments: [] });
    // The menu's badges count every one waiting, not a page of them.
    const counts = (await api.get('/platform/counts').set(bearer(support)).expect(200)).body;
    expect(counts.pendingRequests).toBe(await db.clinicRequest.count({ where: { status: 'PENDING' } }));
    expect(counts.pendingPayments).toBe(await db.platformPayment.count({ where: { status: 'PENDING' } }));
    // Clinic staff never reach it.
    await api.get(`/platform/search?q=${c.invoice.number}`).expect(401);
  });

  it('clinics: revenue, visits in 30 days and the staff limit; found by an admin phone', async () => {
    const c = await payingClinic();
    const admin = await makeUser(c.tenant.id, 'ADMIN');
    const patient = await db.patient.create({ data: { tenantId: c.tenant.id, mrn: 'INS-1', firstName: 'Abebe', fatherName: 'Kebede', sex: 'MALE' } });
    await db.visit.create({ data: { tenantId: c.tenant.id, patientId: patient.id, queueNumber: 1 } });
    await db.visit.create({ data: { tenantId: c.tenant.id, patientId: patient.id, queueNumber: 2, checkedInAt: new Date(Date.now() - 45 * DAY) } });

    const [row] = (await api.get(`/platform/clinics?q=${admin.phone}`).set(bearer(owner)).expect(200)).body;
    expect(row).toMatchObject({ id: c.tenant.id, visits30: 1, mrr: c.basic.priceMonthly.toFixed(2), subscription: { plan: { code: 'BASIC', maxStaff: c.basic.maxStaff } } });
    expect(row.subscription.plan).not.toHaveProperty('priceMonthly');

    // The clinic's page: is it using HMIS?
    await db.auditLog.create({ data: { tenantId: c.tenant.id, userId: admin.id, action: 'auth.login', entity: 'User', entityId: admin.id } });
    await db.auditLog.create({ data: { tenantId: c.tenant.id, userId: admin.id, action: 'auth.login', entity: 'User', entityId: admin.id } });
    const { usage } = (await api.get(`/platform/clinics/${c.tenant.id}`).set(bearer(owner)).expect(200)).body;
    expect(usage).toMatchObject({ visits30: 1, visitsPrevious30: 1, signIns30: 2, staffSignedIn30: 1 });
    expect(usage.days).toHaveLength(30);
    expect(usage.days[29]).toEqual({ day: clinicDay(), visits: 1 });
    expect(usage.lastSignInAt).toBeTruthy();
  });

  it('history: by kind and clinic, with the clinic named, and older pages', async () => {
    const c = await payingClinic();
    await api.patch(`/platform/clinics/${c.tenant.id}/subscription`).set(bearer(owner)).send({ notes: 'Called them about the invoice' }).expect(200);
    const entries = (await api.get(`/platform/audit?area=subscription&tenantId=${c.tenant.id}`).set(bearer(support)).expect(200)).body;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'subscription.updated', clinic: c.name, operator: 'OWNER insights' });

    const signIns = (await api.get('/platform/audit?area=platform').set(bearer(owner)).expect(200)).body;
    expect(signIns.length).toBeGreaterThan(0);
    expect(signIns.every((e: { action: string }) => e.action.startsWith('platform.'))).toBe(true);
    // Older than the entry: not it.
    const older = (await api.get(`/platform/audit?tenantId=${c.tenant.id}&before=${entries[0].id}`).set(bearer(owner)).expect(200)).body;
    expect(older).toHaveLength(0);

    // Entries written at the same instant are not skipped from one page to the next.
    const at = new Date(Date.now() - DAY);
    await db.platformAuditLog.createMany({
      data: ['a', 'b', 'c'].map((x) => ({ id: randomUUID(), action: 'note.added', entity: 'PlatformNote', entityId: x, tenantId: c.tenant.id, createdAt: at })),
    });
    const all = (await api.get(`/platform/audit?tenantId=${c.tenant.id}&area=note`).set(bearer(owner)).expect(200)).body as { id: string }[];
    expect(all).toHaveLength(3);
    const rest = (await api.get(`/platform/audit?tenantId=${c.tenant.id}&area=note&before=${all[0].id}`).set(bearer(owner)).expect(200)).body as { id: string }[];
    expect(rest.map((e) => e.id)).toEqual(all.slice(1).map((e) => e.id));
    // Nonsense filters are ignored, not errors.
    await api.get('/platform/audit?area=DROP%20TABLE&before=yesterday&tenantId=x').set(bearer(owner)).expect(200);
  });
});

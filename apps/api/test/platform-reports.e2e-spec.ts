import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { base32Decode, currentStep, hotp, newSecret } from '../src/auth/totp.js';
import { clinicDay } from '../src/common/clinic-day.js';
import { api, bearer, db, makeClinic, startApp, stopApp } from './helpers.js';

process.env.HMIS_PLATFORM = '1';
process.env.HMIS_SCHEDULER = '0';
beforeAll(startApp);
afterAll(stopApp);

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const dayAgo = (days: number) => clinicDay(ago(days));

async function operator() {
  const op = await db.platformUser.create({
    data: {
      fullName: 'Reports billing',
      email: `rep-${randomUUID()}@hmis.test`,
      role: 'BILLING',
      passwordHash: await bcrypt.hash('operator-password-1', 4),
      mustChangePassword: false,
      totpSecret: newSecret(),
      totpEnabledAt: new Date(),
    },
  });
  const first = await api.post('/platform/auth/login').send({ email: op.email, password: 'operator-password-1' }).expect(200);
  const second = await api.post('/platform/auth/login/two-step').send({ challenge: first.body.challenge, code: hotp(base32Decode(op.totpSecret!), currentStep()) }).expect(200);
  return second.body.token as string;
}

async function billedClinic(opts: { deployment?: 'CLOUD' | 'ON_PREMISE'; paidUntil?: Date } = {}) {
  const tenant = await makeClinic(`Report Clinic ${randomUUID().slice(0, 8)}`);
  await db.tenant.update({ where: { id: tenant.id }, data: { tin: '0012345678' } });
  const basic = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
  const sub = await db.subscription.create({
    data: { tenantId: tenant.id, planId: basic.id, status: 'ACTIVE', deployment: opts.deployment ?? 'CLOUD', paidUntil: opts.paidUntil ?? new Date(Date.now() + 20 * DAY) },
  });
  const invoice = (issuedAt: Date, total: string, status: 'OPEN' | 'PAID' | 'VOID' = 'OPEN') =>
    db.platformInvoice.create({
      data: {
        number: `TEST-REP-${randomUUID().slice(0, 8)}`,
        tenantId: tenant.id,
        subscriptionId: sub.id,
        planName: basic.name,
        cycle: 'MONTHLY',
        periodStart: issuedAt,
        periodEnd: new Date(issuedAt.getTime() + 30 * DAY),
        subtotal: (Number(total) / 1.15).toFixed(2),
        vat: (Number(total) - Number((Number(total) / 1.15).toFixed(2))).toFixed(2),
        total,
        status,
        issuedAt,
        dueDate: new Date(issuedAt.getTime() + 7 * DAY),
        ...(status === 'VOID' && { voidedAt: issuedAt, voidReason: 'Issued twice' }),
      },
    });
  const pay = (invoiceId: string, amount: string, paidAt: Date) =>
    db.platformPayment.create({ data: { invoiceId, tenantId: tenant.id, amount, method: 'BANK_TRANSFER', status: 'CONFIRMED', reference: `FT${randomUUID().slice(0, 10)}`, paidAt } });
  return { tenant, sub, invoice, pay };
}

describe('the platform console: accounts and health', () => {
  let token: string;
  beforeAll(async () => {
    token = await operator();
  });

  it('a statement of account: opening balance, invoices and payments with a running balance', async () => {
    const c = await billedClinic();
    const a = await c.invoice(ago(40), '1000.00', 'PAID');
    await c.pay(a.id, '1000.00', ago(35));
    await c.invoice(ago(10), '500.00', 'VOID'); // left out
    const b = await c.invoice(ago(5), '1000.00');
    await c.pay(b.id, '300.00', ago(2));

    const all = (await api.get(`/platform/clinics/${c.tenant.id}/statement?from=${dayAgo(60)}`).set(bearer(token)).expect(200)).body;
    expect(all.opening).toBe('0.00');
    expect(all.lines.map((l: { kind: string; debit: string; credit: string; balance: string }) => [l.kind, l.debit, l.credit, l.balance])).toEqual([
      ['INVOICE', '1000.00', '0.00', '1000.00'],
      ['PAYMENT', '0.00', '1000.00', '0.00'],
      ['INVOICE', '1000.00', '0.00', '1000.00'],
      ['PAYMENT', '0.00', '300.00', '700.00'],
    ]);
    expect(all).toMatchObject({ closing: '700.00', totals: { invoiced: '2000.00', paid: '1300.00' }, clinic: { tin: '0012345678' } });
    expect(all.open).toEqual([expect.objectContaining({ id: b.id, balance: '700.00' })]);

    // From three days ago: what was owed before is the opening balance.
    const recent = (await api.get(`/platform/clinics/${c.tenant.id}/statement?from=${dayAgo(3)}&to=${clinicDay()}`).set(bearer(token)).expect(200)).body;
    expect(recent).toMatchObject({ opening: '1000.00', closing: '700.00' });
    expect(recent.lines).toHaveLength(1);

    await api.get(`/platform/clinics/${c.tenant.id}/statement?from=2026-13-45`).set(bearer(token)).expect(400);
    await api.get(`/platform/clinics/${c.tenant.id}/statement?from=${clinicDay()}&to=${dayAgo(5)}`).set(bearer(token)).expect(400);
    await api.get(`/platform/clinics/${randomUUID()}/statement`).set(bearer(token)).expect(404);
    await api.get(`/platform/clinics/${c.tenant.id}/statement?from=2026-02-30`).set(bearer(token)).expect(400);

    // A past period: the invoice issued after it is still among the unpaid ones today.
    const past = (await api.get(`/platform/clinics/${c.tenant.id}/statement?from=${dayAgo(60)}&to=${dayAgo(30)}`).set(bearer(token)).expect(200)).body;
    expect(past.lines).toHaveLength(2);
    expect(past.open).toEqual([expect.objectContaining({ id: b.id, balance: '700.00' })]);
  });

  it('sales by month and the VAT register: voided invoices listed but not counted', async () => {
    const year = clinicDay().slice(0, 4);
    const month = Number(clinicDay().slice(5, 7)) - 1;
    const before = (await api.get(`/platform/reports/sales?year=${year}`).set(bearer(token)).expect(200)).body;
    const c = await billedClinic();
    const open = await c.invoice(new Date(), '1150.00');
    const voided = await c.invoice(new Date(), '1150.00', 'VOID');
    await c.pay(open.id, '500.00', new Date());
    const after = (await api.get(`/platform/reports/sales?year=${year}`).set(bearer(token)).expect(200)).body;
    const [m0, m1] = [before.months[month], after.months[month]];
    expect(m1.invoices - m0.invoices).toBe(1);
    expect(m1.voided - m0.voided).toBe(1);
    expect((Number(m1.vat) - Number(m0.vat)).toFixed(2)).toBe('150.00');
    expect((Number(m1.total) - Number(m0.total)).toFixed(2)).toBe('1150.00');
    expect((Number(m1.collected) - Number(m0.collected)).toFixed(2)).toBe('500.00');
    expect(after.years).toContain(Number(year));
    await api.get('/platform/reports/sales?year=1800').set(bearer(token)).expect(400);

    const reg = (await api.get(`/platform/reports/vat-register?from=${clinicDay()}&to=${clinicDay()}`).set(bearer(token)).expect(200)).body;
    const mine = reg.invoices.filter((i: { tenantId: string }) => i.tenantId === c.tenant.id);
    expect(mine.map((i: { id: string; status: string; tin: string }) => [i.id, i.status, i.tin]).sort()).toEqual(
      [
        [open.id, 'OPEN', '0012345678'],
        [voided.id, 'VOID', '0012345678'],
      ].sort(),
    );
    const counted = reg.invoices.filter((i: { status: string }) => i.status !== 'VOID');
    expect(reg.totals.invoices).toBe(counted.length);
    const vatCents = counted.reduce((sum: number, i: { vat: string }) => sum + Math.round(Number(i.vat) * 100), 0);
    expect(reg.totals.vat).toBe((vatCents / 100).toFixed(2));
  });

  it('health: offline and outdated servers, failed online payments, licences ending, setup', async () => {
    const c = await billedClinic({ deployment: 'ON_PREMISE', paidUntil: new Date(Date.now() + 5 * DAY) });
    const before = (await api.get('/platform/counts').set(bearer(token)).expect(200)).body.serversOffline as number;
    const server = await db.syncClient.create({
      data: { tenantId: c.tenant.id, name: 'Front office server', tokenHash: randomUUID(), lastSeenAt: ago(2), edgeVersion: '20200101000000_old', lastError: 'connect ETIMEDOUT' },
    });
    const ok = await db.syncClient.create({ data: { tenantId: c.tenant.id, name: 'Lab server', tokenHash: randomUUID(), lastSeenAt: new Date() } });
    // Registered just now and not connected yet: being set up, not an alarm.
    const fresh = await db.syncClient.create({ data: { tenantId: c.tenant.id, name: 'New server', tokenHash: randomUUID() } });
    const stale = await db.syncClient.create({ data: { tenantId: c.tenant.id, name: 'Forgotten server', tokenHash: randomUUID(), createdAt: ago(3) } });
    const inv = await c.invoice(new Date(), '1150.00');
    const checkout = await db.platformCheckout.create({
      data: { reference: `hmis-${randomUUID()}`, provider: 'CHAPA', invoiceId: inv.id, tenantId: c.tenant.id, amount: '1150.00', status: 'FAILED', lastError: 'Card declined' },
    });
    const h = (await api.get('/platform/health').set(bearer(token)).expect(200)).body;
    expect(h.servers.find((s: { id: string }) => s.id === server.id)).toMatchObject({ status: 'offline', behind: true, clinic: c.tenant.name });
    expect(h.servers.find((s: { id: string }) => s.id === ok.id)).toMatchObject({ status: 'ok' });
    expect(h.servers.find((s: { id: string }) => s.id === fresh.id)).toMatchObject({ status: 'new' });
    expect(h.servers.find((s: { id: string }) => s.id === stale.id)).toMatchObject({ status: 'never' });
    expect(h.checkouts.failed.find((f: { id: string }) => f.id === checkout.id)).toMatchObject({ clinic: c.tenant.name, lastError: 'Card declined' });
    expect(h.checkouts.byProvider.find((p: { provider: string }) => p.provider === 'CHAPA').failed).toBeGreaterThanOrEqual(1);
    expect(h.licences.find((l: { tenantId: string }) => l.tenantId === c.tenant.id)).toMatchObject({ deployment: 'ON_PREMISE', daysLeft: expect.any(Number) });
    expect(h.setup.map((s: { key: string }) => s.key)).toEqual(['publicUrl', 'chapa', 'telebirr', 'licences', 'company', 'bank', 'support']);
    expect((await api.get('/platform/counts').set(bearer(token)).expect(200)).body.serversOffline).toBe(before + 2);
    await db.syncClient.updateMany({ where: { id: { in: [server.id, ok.id, fresh.id, stale.id] } }, data: { revokedAt: new Date() } });
  });
});

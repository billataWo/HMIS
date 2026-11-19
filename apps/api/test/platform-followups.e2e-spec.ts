import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PlatformRole } from '@hmis/db';
import { base32Decode, currentStep, hotp, newSecret } from '../src/auth/totp.js';
import { clinicDay } from '../src/common/clinic-day.js';
import { api, bearer, db, makeClinic, makeStaff, makeUser, startApp, stopApp } from './helpers.js';

process.env.HMIS_PLATFORM = '1';
process.env.HMIS_SCHEDULER = '0';
beforeAll(startApp);
afterAll(stopApp);

const DAY = 86_400_000;
const PASSWORD = 'operator-password-1';
const dayFromNow = (n: number) => clinicDay(new Date(Date.now() + n * DAY));

async function operator(role: PlatformRole) {
  const op = await db.platformUser.create({
    data: {
      fullName: `${role} follow-up`,
      email: `fup-${randomUUID()}@hmis.test`,
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
  return { id: op.id, name: op.fullName, token: second.body.token as string };
}

/** A clinic on BASIC with an open invoice of 1,000 ETB, five days late. */
async function owingClinic() {
  const tenant = await makeClinic(`Follow-up Clinic ${randomUUID().slice(0, 8)}`);
  const basic = await db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
  const sub = await db.subscription.create({ data: { tenantId: tenant.id, planId: basic.id, status: 'ACTIVE', paidUntil: new Date(Date.now() + 9 * DAY) } });
  const invoice = await db.platformInvoice.create({
    data: {
      number: `TEST-FUP-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      subscriptionId: sub.id,
      planName: basic.name,
      cycle: 'MONTHLY',
      periodStart: new Date(Date.now() - 20 * DAY),
      periodEnd: new Date(Date.now() + 10 * DAY),
      subtotal: '869.57',
      vat: '130.43',
      total: '1000.00',
      dueDate: new Date(Date.now() - 5 * DAY),
    },
  });
  return { tenant, invoice };
}

describe('the platform console: follow-ups on clinics', () => {
  let support: Awaited<ReturnType<typeof operator>>;
  let billing: Awaited<ReturnType<typeof operator>>;
  beforeAll(async () => {
    support = await operator('SUPPORT');
    billing = await operator('BILLING');
  });

  it('notes a call and a promise to pay, lists what is due, and marks it done', async () => {
    const { tenant, invoice } = await owingClinic();
    // No phone of its own: the admin's is the one to call.
    const admin = await makeUser(tenant.id, 'ADMIN');
    const counts = async () => (await api.get('/platform/counts').set(bearer(support.token)).expect(200)).body.followUpsDue as number;
    const before = await counts();

    // A promise needs its day; the day cannot have passed.
    await api.post(`/platform/clinics/${tenant.id}/notes`).set(bearer(billing.token)).send({ kind: 'PROMISE', body: 'Will pay on Friday' }).expect(400);
    await api.post(`/platform/clinics/${tenant.id}/notes`).set(bearer(billing.token)).send({ kind: 'PROMISE', body: 'Will pay', followUpOn: dayFromNow(-2) }).expect(409);
    await api.post(`/platform/clinics/${randomUUID()}/notes`).set(bearer(billing.token)).send({ body: 'Nobody' }).expect(404);

    const call = await api.post(`/platform/clinics/${tenant.id}/notes`).set(bearer(support.token)).send({ kind: 'CALL', body: 'Spoke to the manager about the invoice' }).expect(201);
    const today = await api.post(`/platform/clinics/${tenant.id}/notes`).set(bearer(support.token)).send({ body: 'Call back about the trial', followUpOn: dayFromNow(0) }).expect(201);
    const promise = await api.post(`/platform/clinics/${tenant.id}/notes`).set(bearer(billing.token)).send({ kind: 'PROMISE', body: 'Will pay by transfer', followUpOn: dayFromNow(3) }).expect(201);
    expect(await counts()).toBe(before + 1);

    // Due today: with the clinic, what it owes and who wrote it.
    const due = (await api.get('/platform/follow-ups').set(bearer(support.token)).expect(200)).body;
    const row = due.notes.find((n: { id: string }) => n.id === today.body.id);
    expect(row).toMatchObject({ clinic: { id: tenant.id, name: tenant.name, phone: admin.phone }, owes: '1000.00', daysLate: 0, operator: support.name });
    expect(due.notes.some((n: { id: string }) => n.id === promise.body.id || n.id === call.body.id)).toBe(false);
    expect(due.summary.dueMine).toBeGreaterThanOrEqual(1);
    // Only mine: billing wrote nothing due today.
    const mine = (await api.get('/platform/follow-ups?mine=1').set(bearer(billing.token)).expect(200)).body;
    expect(mine.notes.some((n: { tenantId: string }) => n.tenantId === tenant.id)).toBe(false);
    const upcoming = (await api.get('/platform/follow-ups?scope=upcoming').set(bearer(support.token)).expect(200)).body;
    expect(upcoming.notes.some((n: { id: string }) => n.id === promise.body.id)).toBe(true);

    // The promise shows on the invoice ledger, and is broken once its day has passed.
    const ledger = async () =>
      (await api.get(`/platform/invoices?status=OPEN&q=${invoice.number}`).set(bearer(billing.token)).expect(200)).body.invoices.find((i: { id: string }) => i.id === invoice.id);
    expect((await ledger()).promise).toMatchObject({ broken: false });
    await db.platformNote.update({ where: { id: promise.body.id }, data: { followUpOn: new Date(`${dayFromNow(-2)}T00:00:00+03:00`) } });
    expect((await ledger()).promise).toMatchObject({ broken: true });
    const late = (await api.get('/platform/follow-ups').set(bearer(support.token)).expect(200)).body.notes.find((n: { id: string }) => n.id === promise.body.id);
    expect(late.daysLate).toBe(2);

    // Done: off the list, once.
    await api.post(`/platform/notes/${today.body.id}/done`).set(bearer(support.token)).expect(200);
    await api.post(`/platform/notes/${today.body.id}/done`).set(bearer(support.token)).expect(409);
    await api.post(`/platform/notes/${call.body.id}/done`).set(bearer(support.token)).expect(409);
    const after = (await api.get('/platform/follow-ups').set(bearer(support.token)).expect(200)).body;
    expect(after.notes.some((n: { id: string }) => n.id === today.body.id)).toBe(false);
    const done = (await api.get('/platform/follow-ups?scope=done').set(bearer(support.token)).expect(200)).body;
    expect(done.notes.find((n: { id: string }) => n.id === today.body.id)).toMatchObject({ doneBy: support.name });

    // On the clinic page, with names; and in the history.
    const detail = (await api.get(`/platform/clinics/${tenant.id}`).set(bearer(support.token)).expect(200)).body;
    expect(detail.notes).toHaveLength(3);
    expect(detail.notes.find((n: { id: string }) => n.id === call.body.id)).toMatchObject({ kind: 'CALL', operator: support.name });
    const history = (await api.get(`/platform/audit?tenantId=${tenant.id}&area=note`).set(bearer(support.token)).expect(200)).body;
    expect(history.map((h: { action: string }) => h.action).sort()).toEqual(['note.added', 'note.added', 'note.added', 'note.done']);
  });
});

describe('the platform console: announcements to clinics', () => {
  it('shows what is live to the right clinics, warnings first, until withdrawn', async () => {
    const support = await operator('SUPPORT');
    const a = await makeClinic(`Announce A ${randomUUID().slice(0, 8)}`);
    const b = await makeClinic(`Announce B ${randomUUID().slice(0, 8)}`);
    const staffA = await makeStaff(a.id, 'NURSE');
    const staffB = await makeStaff(b.id, 'CASHIER');
    const tag = randomUUID().slice(0, 8);

    await api.post('/platform/announcements').set(bearer(support.token)).send({ title: 'Ends first', endsAt: new Date(Date.now() - DAY) }).expect(400);
    await api.post('/platform/announcements').set(bearer(support.token)).send({ title: 'Nobody', tenantId: randomUUID() }).expect(404);
    await api.post('/platform/announcements').set(bearer(staffA.token)).send({ title: 'From a clinic' }).expect(401);

    const all = await api
      .post('/platform/announcements')
      .set(bearer(support.token))
      .send({ title: `New reports ${tag}`, titleAm: `አዲስ ሪፖርቶች ${tag}`, body: 'Monthly reports are faster.', endsAt: new Date(Date.now() + 7 * DAY) })
      .expect(201);
    const onlyA = await api.post('/platform/announcements').set(bearer(support.token)).send({ title: `Your server ${tag}`, tone: 'WARNING', tenantId: a.id }).expect(201);
    const later = await api.post('/platform/announcements').set(bearer(support.token)).send({ title: `Later ${tag}`, startsAt: new Date(Date.now() + 2 * DAY) }).expect(201);

    const seen = async (token: string) => ((await api.get('/announcements').set(bearer(token)).expect(200)).body as { id: string; title: string }[]).filter((x) => x.title.includes(tag));
    const forA = await seen(staffA.token);
    expect(forA.map((x) => x.id)).toEqual([onlyA.body.id, all.body.id]);
    expect((await seen(staffB.token)).map((x) => x.id)).toEqual([all.body.id]);

    const list = (await api.get('/platform/announcements').set(bearer(support.token)).expect(200)).body as { id: string; state: string; clinic: string | null; createdBy: string }[];
    expect(list.find((x) => x.id === later.body.id)?.state).toBe('scheduled');
    expect(list.find((x) => x.id === onlyA.body.id)).toMatchObject({ state: 'live', clinic: a.name, createdBy: support.name });

    await api.post(`/platform/announcements/${all.body.id}/withdraw`).set(bearer(support.token)).expect(200);
    await api.post(`/platform/announcements/${all.body.id}/withdraw`).set(bearer(support.token)).expect(409);
    expect(await seen(staffB.token)).toEqual([]);
    await api.post(`/platform/announcements/${onlyA.body.id}/withdraw`).set(bearer(support.token)).expect(200);
    await api.post(`/platform/announcements/${later.body.id}/withdraw`).set(bearer(support.token)).expect(200);
    const audit = await db.platformAuditLog.count({ where: { operatorId: support.id, action: { startsWith: 'announcement.' } } });
    expect(audit).toBe(6);
  });
});

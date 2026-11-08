import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createPrismaClient } from '@hmis/db';
import { newSecret } from '../src/auth/totp.js';
import { enableCapture, disableCapture, hashToken, NOT_SYNCED, readOutbox } from '../src/sync/engine.js';
import { pushOnce, type Transport } from '../src/sync/sync.agent.js';
import { EDGE_APP_URL, EDGE_URL } from './global-setup.js';
import { api, bearer, db, login, phone, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

/**
 * hmis_test plays the cloud (the API under test), hmis_test_edge a clinic server: changes made
 * there are captured, sent through the cloud's /sync/push, and must arrive intact, in order,
 * and only for that clinic.
 */
describe('clinic server → cloud sync', () => {
  const edge = createPrismaClient(EDGE_URL);
  let tenantId = '';
  const edgeApp = createPrismaClient(EDGE_APP_URL, { tenant: () => tenantId });
  let token = '';
  let staffPhone = '';
  let patientId = '';

  const transport =
    (secret = token): Transport =>
    async (body) => {
      const res = await api.post('/sync/push').set(bearer(secret)).send(body);
      return res.status === 200 ? { ok: true, applied: res.body.applied } : { ok: false, status: res.status, message: String(res.body.message) };
    };
  /** Sends until nothing is left, like the agent does. */
  async function drain() {
    for (let i = 0; i < 50; i++) {
      const r = await pushOnce(edge, transport());
      if (!r.ok) throw new Error(r.message);
      if (r.sent === 0) return;
    }
    throw new Error('outbox never drained');
  }

  beforeAll(async () => {
    // A fresh clinic server holding one clinic that was running before sync was switched on.
    await disableCapture(edge);
    await edge.$executeRawUnsafe('TRUNCATE "Tenant" CASCADE');
    await edge.$executeRawUnsafe('DELETE FROM "SyncOutbox"');
    await edge.$executeRawUnsafe(`UPDATE "SyncState" SET "lastPushAt" = NULL, "lastError" = NULL, "pushedRows" = 0 WHERE "id" = 1`);
    const tenant = await edge.tenant.create({ data: { name: 'Edge Clinic', requirePrepayment: false } });
    tenantId = tenant.id;
    staffPhone = phone();
    // Admins use two-step sign-in; the secret travels with the account to the cloud copy.
    await edge.user.create({
      data: { tenantId, phone: staffPhone, role: 'ADMIN', fullName: 'Edge Admin', passwordHash: await bcrypt.hash('password123', 4), totpSecret: newSecret(), totpEnabledAt: new Date() },
    });
    patientId = (await edge.patient.create({ data: { tenantId, mrn: 'EDGE-1', firstName: 'Almaz', fatherName: 'Tesfaye', sex: 'FEMALE' } })).id;
    await edge.serviceItem.create({ data: { tenantId, code: 'FEE', name: 'Consultation', price: '150.25' } });

    // The cloud issues the clinic server's token (the CLI does this with `token create`).
    token = randomBytes(32).toString('base64url');
    await db.tenant.create({ data: { id: tenantId, name: 'placeholder (replaced by sync)' } }).catch(() => undefined);
    await db.syncClient.create({ data: { tenantId, name: 'Edge server', tokenHash: hashToken(token) } });
  });
  afterAll(async () => {
    await disableCapture(edge);
    await Promise.all([edge.$disconnect(), edgeApp.$disconnect()]);
  });

  it('captures every clinic table (a new table must call hmis_sync_attach in its migration)', async () => {
    const rows = await edge.$queryRawUnsafe<{ relname: string; has: boolean }[]>(`
      SELECT c.relname, EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'hmis_sync_capture') AS has
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`);
    const missing = rows.filter((r) => !NOT_SYNCED.has(r.relname) && !r.has).map((r) => r.relname);
    expect(missing).toEqual([]);
    expect(rows.length).toBeGreaterThan(20);
  });

  it('captures nothing until sync is enabled, then sends the whole clinic once', async () => {
    expect(await readOutbox(edge)).toEqual([]);
    const queued = await enableCapture(edge, { snapshot: true });
    expect(queued).toBeGreaterThanOrEqual(4);
    await drain();

    const cloudPatient = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect([cloudPatient.firstName, cloudPatient.mrn, cloudPatient.tenantId]).toEqual(['Almaz', 'EDGE-1', tenantId]);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name).toBe('Edge Clinic');
    expect((await db.serviceItem.findFirstOrThrow({ where: { tenantId, code: 'FEE' } })).price.toString()).toBe('150.25');
    expect((await db.syncClient.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } })).appliedRows).toBeGreaterThanOrEqual(4n);
    expect(await readOutbox(edge)).toEqual([]);
  });

  it('sends ongoing work made through the app role: inserts, updates, deletes', async () => {
    await edgeApp.patient.update({ where: { id: patientId }, data: { phone: '0911223344', allergies: ['Penicillin'] } });
    const visit = await edgeApp.visit.create({ data: { tenantId, patientId, queueNumber: 1 } });
    const appt = await edgeApp.appointment.create({ data: { tenantId, patientId, scheduledAt: new Date(Date.now() + 86_400_000) } });
    await edgeApp.appointment.delete({ where: { id: appt.id } });
    await drain();

    const p = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect([p.phone, p.allergies]).toEqual(['0911223344', ['Penicillin']]);
    expect(await db.visit.findUnique({ where: { id: visit.id } })).not.toBeNull();
    expect(await db.appointment.findUnique({ where: { id: appt.id } })).toBeNull();
  });

  it('never sends a change ahead of an older transaction that is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const inside = new Promise<void>((r) => (started = r));
    const slow = edge.$transaction(
      async (tx) => {
        await tx.patient.create({ data: { tenantId, mrn: 'MRN-SLOW', firstName: 'Slow', fatherName: 'Writer', sex: 'MALE' } });
        started();
        await gate;
      },
      { timeout: 20_000 },
    );
    await inside;
    await edge.patient.create({ data: { tenantId, mrn: 'MRN-FAST', firstName: 'Fast', fatherName: 'Writer', sex: 'MALE' } });
    // The fast one committed, but the slow, older transaction is still open: nothing is ready.
    expect(await readOutbox(edge)).toEqual([]);
    release();
    await slow;
    const ready = await readOutbox(edge);
    expect(ready.map((c) => JSON.parse(c.row!).mrn)).toEqual(['MRN-SLOW', 'MRN-FAST']);
    await drain();
    expect(await db.patient.count({ where: { tenantId, mrn: { in: ['MRN-SLOW', 'MRN-FAST'] } } })).toBe(2);
  });

  it('keeps changes on the clinic server while the cloud cannot be reached, then catches up', async () => {
    await edgeApp.patient.update({ where: { id: patientId }, data: { address: 'Bahir Dar' } });
    const offline: Transport = async () => ({ ok: false, status: 0, message: 'Cannot reach the cloud: fetch failed' });
    expect((await pushOnce(edge, offline)).ok).toBe(false);
    expect((await readOutbox(edge)).length).toBe(1);
    expect((await edge.syncState.findUniqueOrThrow({ where: { id: 1 } })).lastError).toContain('Cannot reach');
    await drain();
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).address).toBe('Bahir Dar');
    expect((await edge.syncState.findUniqueOrThrow({ where: { id: 1 } })).lastError).toBeNull();
  });

  it('makes the cloud copy read-only; staff can still sign in and look things up there', async () => {
    const t = await login(staffPhone);
    const found = (await api.get(`/patients/${patientId}`).set(bearer(t)).expect(200)).body;
    expect(found.firstName).toBe('Almaz');
    const refused = await api.post('/patients').set(bearer(t)).send({ firstName: 'New', fatherName: 'Person', sex: 'MALE', confirmDuplicate: true }).expect(409);
    expect(refused.body.code).toBe('CLOUD_COPY_READ_ONLY');
    const status = (await api.get('/sync/status').set(bearer(t)).expect(200)).body;
    expect(status.mode).toBe('cloud-copy');
    expect(status.clients[0]).toMatchObject({ name: 'Edge server', lastError: null });
  });

  it("refuses rows of another clinic, and applies nothing of that batch", async () => {
    const other = await db.tenant.create({ data: { name: 'Victim Clinic' } });
    const good = { id: crypto.randomUUID(), tenantId, mrn: 'MRN-OK', firstName: 'Fine', fatherName: 'Row', sex: 'MALE' };
    const evil = { id: crypto.randomUUID(), tenantId: other.id, mrn: 'MRN-EVIL', firstName: 'Planted', fatherName: 'Row', sex: 'MALE' };
    const change = (seq: string, row: object & { id: string }) => ({ seq, table: 'Patient', op: 'U', key: JSON.stringify({ id: row.id }), row: JSON.stringify(row) });
    const res = await api.post('/sync/push').set(bearer(token)).send({ edgeVersion: '', changes: [change('1', good), change('2', evil)] }).expect(409);
    expect(res.body.message).toMatch(/row-level security|Patient/);
    expect(await db.patient.count({ where: { id: { in: [good.id, evil.id] } } })).toBe(0);
    expect((await db.syncClient.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } })).lastError).toBeTruthy();
    await drain(); // the clinic server's own queue is unaffected
  });

  it('checks the token and the schema version', async () => {
    await api.post('/sync/push').send({ edgeVersion: '', changes: [] }).expect(401);
    await api.post('/sync/push').set(bearer(randomBytes(32).toString('base64url'))).send({ edgeVersion: '', changes: [] }).expect(401);
    const newer = await api.post('/sync/push').set(bearer(token)).send({ edgeVersion: '99999999999999_future', changes: [] }).expect(409);
    expect(newer.body.code).toBe('CLOUD_OUTDATED');
    // A heartbeat (nothing to send) marks the clinic server as seen.
    await api.post('/sync/push').set(bearer(token)).send({ edgeVersion: '', changes: [] }).expect(200);
  });

  it('exports exactly this clinic for setting up its clinic server', async () => {
    const res = await api.get('/sync/export').set(bearer(token)).buffer(true).parse((r, cb) => {
      let text = '';
      r.on('data', (c: Buffer) => (text += c.toString()));
      r.on('end', () => cb(null, text));
    });
    const lines = (res.body as string).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'meta', tenantId });
    const rows = lines.filter((l) => l.type === 'row');
    expect(lines.at(-1)).toEqual({ type: 'end', rows: rows.length });
    // Parents first: the clinic itself, before its staff and patients.
    expect(rows[0].table).toBe('Tenant');
    expect(rows.every((l) => l.table === 'Tenant' ? l.row.id === tenantId : l.row.tenantId === undefined || l.row.tenantId === tenantId)).toBe(true);
    expect(rows.some((l) => l.table === 'Patient' && l.row.id === patientId)).toBe(true);
  });

  it('lets the cloud copy be edited again once the token is revoked', async () => {
    await db.syncClient.updateMany({ where: { tenantId }, data: { revokedAt: new Date() } });
    const { forgetCloudCopy } = await import('../src/sync/read-only.guard.js');
    forgetCloudCopy(tenantId);
    const t = await login(staffPhone);
    await api.post('/patients').set(bearer(t)).send({ firstName: 'Back', fatherName: 'Online', sex: 'MALE', confirmDuplicate: true }).expect(201);
    await api.post('/sync/push').set(bearer(token)).send({ edgeVersion: '', changes: [] }).expect(401);
  });
});

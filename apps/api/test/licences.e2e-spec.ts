import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { newSecret, base32Decode, currentStep, hotp } from '../src/auth/totp.js';
import { type Licence, readLicence, signLicence } from '../src/licence/licence.js';
import { refreshLicence } from '../src/licence/licence.agent.js';
import { forgetSubscription } from '../src/platform/subscription.guard.js';
import { hashToken } from '../src/sync/engine.js';
import { api, appPrisma, appUrl, bearer, db, makeClinic, makeStaff, phone, startApp, stopApp } from './helpers.js';

const DAY = 86_400_000;
const hmis = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const stranger = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

Object.assign(process.env, {
  HMIS_SCHEDULER: '0',
  HMIS_LICENCE_PRIVATE_KEY: hmis.privateKey.replace(/\n/g, '\\n'), // as written in deploy/.env
  HMIS_LICENCE_PUBLIC_KEY: hmis.publicKey,
});
beforeAll(startApp);
afterAll(stopApp);

/** Runs as the HMIS cloud, or as a clinic server that needs a licence. */
function as(mode: 'cloud' | 'clinic-server' | 'plain') {
  process.env.HMIS_PLATFORM = mode === 'cloud' ? '1' : '0';
  process.env.HMIS_LICENCE = mode === 'clinic-server' ? 'required' : '';
  forgetSubscription();
}

function licenceFor(tenantId: string, extra: Partial<Licence> = {}, key = hmis.privateKey) {
  const l: Licence = {
    v: 1,
    id: randomUUID(),
    tenantId,
    clinicName: 'Licensed Clinic',
    plan: { code: 'BASIC', name: 'Basic', maxStaff: 3, features: [] },
    deployment: 'ON_PREMISE',
    status: 'ACTIVE',
    endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
    graceDays: 14,
    suspended: false,
    issuedAt: new Date().toISOString(),
    ...extra,
  };
  return signLicence(l, key);
}

describe('licence files', () => {
  it('are accepted only as signed by HMIS, unchanged', () => {
    const text = licenceFor(randomUUID());
    expect(readLicence(text, hmis.publicKey).ok).toBe(true);
    const [prefix, payload, sig] = text.split('.');
    const changed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    changed.plan.maxStaff = null;
    expect(readLicence(`${prefix}.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${sig}`, hmis.publicKey)).toMatchObject({ ok: false });
    expect(readLicence(licenceFor(randomUUID(), {}, stranger.privateKey), hmis.publicKey)).toMatchObject({ ok: false, reason: expect.stringContaining('not issued by HMIS') });
    expect(readLicence('hello', hmis.publicKey)).toMatchObject({ ok: false });
  });
});

describe('on the HMIS cloud', () => {
  let tenantId: string;
  let token: string;

  beforeAll(async () => {
    as('cloud');
    tenantId = (await makeClinic('Cloud Licence Clinic')).id;
    const plan = await db.plan.findUniqueOrThrow({ where: { code: 'STANDARD' } });
    await db.subscription.create({ data: { tenantId, planId: plan.id, status: 'ACTIVE', deployment: 'CLINIC_SERVER', paidUntil: new Date(Date.now() + 40 * DAY) } });
    token = randomBytes(32).toString('base64url');
    await db.syncClient.create({ data: { tenantId, name: 'Licence test server', tokenHash: hashToken(token) } });
  });
  afterAll(() => as('plain'));

  it('issues the licence file for the console', async () => {
    const secret = newSecret();
    const op = await db.platformUser.create({
      data: { fullName: 'Billing', email: `op-${randomUUID()}@hmis.test`, role: 'BILLING', passwordHash: await bcrypt.hash('operator-password-1', 4), mustChangePassword: false, totpSecret: secret, totpEnabledAt: new Date() },
    });
    const first = (await api.post('/platform/auth/login').send({ email: op.email, password: 'operator-password-1' }).expect(200)).body;
    const opToken = (await api.post('/platform/auth/login/two-step').send({ challenge: first.challenge, code: hotp(base32Decode(secret), currentStep()) }).expect(200)).body.token;

    const file = (await api.get(`/platform/clinics/${tenantId}/licence`).set(bearer(opToken)).expect(200)).body;
    expect(file.filename).toMatch(/^hmis-licence-cloud-licence-clinic-\d{4}-\d{2}-\d{2}\.txt$/);
    const read = readLicence(file.licence, hmis.publicKey);
    if (!read.ok) throw new Error(read.reason);
    expect(read.licence).toMatchObject({ tenantId, clinicName: 'Cloud Licence Clinic', status: 'ACTIVE', deployment: 'CLINIC_SERVER', plan: { code: 'STANDARD', maxStaff: 15 } });
  });

  it('gives a clinic server its own licence, with its sync token only', async () => {
    await api.get('/sync/licence').expect(401);
    await api.get('/sync/licence').set(bearer(randomBytes(32).toString('base64url'))).expect(401);
    const { licence } = (await api.get('/sync/licence').set(bearer(token)).expect(200)).body;
    const read = readLicence(licence, hmis.publicKey);
    expect(read.ok && read.licence.tenantId).toBe(tenantId);
  });

  it('is fetched and installed by the clinic server, then applies there', async () => {
    const { licence, changed } = await refreshLicence(appPrisma(), appUrl(), token);
    expect(changed).toBe(true);
    expect(licence.tenantId).toBe(tenantId);
    expect((await db.installedLicence.findUniqueOrThrow({ where: { tenantId } })).source).toBe('sync');

    as('clinic-server');
    const admin = await makeStaff(tenantId, 'ADMIN');
    const me = (await api.get('/auth/me').set(bearer(admin.token)).expect(200)).body;
    expect(me.subscription).toMatchObject({ state: 'active', source: 'licence', planName: 'Standard' });
    const sub = (await api.get('/subscription').set(bearer(admin.token)).expect(200)).body;
    expect(sub).toMatchObject({ managed: true, source: 'licence', licence: { source: 'sync' }, plan: { maxStaff: 15 } });
    as('cloud');
  });
});

describe('on a server that needs a licence', () => {
  let tenantId: string;
  let admin: { id: string; token: string };
  const upload = (licence: string) => api.post('/subscription/licence').set(bearer(admin.token)).send({ licence });
  const write = () => api.post('/displays').set(bearer(admin.token)).send({ name: 'TV' });

  beforeAll(async () => {
    as('plain');
    tenantId = (await makeClinic('Own Server Clinic')).id;
    admin = await makeStaff(tenantId, 'ADMIN');
    as('clinic-server');
  });
  afterAll(() => as('plain'));

  it('is read-only without one, but the licence can be installed', async () => {
    const me = (await api.get('/auth/me').set(bearer(admin.token)).expect(200)).body;
    expect(me.subscription).toMatchObject({ readOnly: true, unlicensed: true });
    expect((await write().expect(402)).body.message).toContain('no valid HMIS licence');
    await api.get('/patients').set(bearer(admin.token)).expect(200);

    expect((await upload(licenceFor(randomUUID())).expect(400)).body.message).toContain('not this clinic');
    expect((await upload(licenceFor(tenantId, {}, stranger.privateKey)).expect(400)).body.message).toContain('not issued by HMIS');
    expect((await upload(licenceFor(tenantId)).expect(201)).body).toMatchObject({ ok: true, changed: true, plan: 'Basic' });
    await write().expect(201);
  });

  it("applies the licence's plan: staff limit", async () => {
    const add = () => api.post('/users').set(bearer(admin.token)).send({ fullName: 'Nurse', phone: phone(), role: 'NURSE', password: 'password123' });
    await add().expect(201);
    await add().expect(201); // 3 with the admin
    expect((await add().expect(403)).body.code).toBe('STAFF_LIMIT');
  });

  it('runs out like a subscription: overdue, then read-only until a new licence', async () => {
    await upload(licenceFor(tenantId, { endsAt: new Date(Date.now() - 3 * DAY).toISOString() })).expect(201);
    forgetSubscription(tenantId);
    expect((await api.get('/auth/me').set(bearer(admin.token)).expect(200)).body.subscription).toMatchObject({ state: 'overdue', readOnly: false });

    await upload(licenceFor(tenantId, { endsAt: new Date(Date.now() - 20 * DAY).toISOString() })).expect(201);
    expect((await write().expect(402)).body.code).toBe('SUBSCRIPTION_SUSPENDED');

    await upload(licenceFor(tenantId, { endsAt: new Date(Date.now() + 365 * DAY).toISOString() })).expect(201);
    await write().expect(201);
  });

  it('cannot go back to an older licence', async () => {
    const older = licenceFor(tenantId, { issuedAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + 9999 * DAY).toISOString() });
    expect((await upload(older).expect(409)).body.message).toContain('newer licence');
  });

  it('is left alone when the server does not require licences', async () => {
    as('plain');
    const other = (await makeClinic('No Licence Needed')).id;
    const otherAdmin = await makeStaff(other, 'ADMIN');
    const me = (await api.get('/auth/me').set(bearer(otherAdmin.token)).expect(200)).body;
    expect(me.subscription).toBeNull();
    await api.post('/displays').set(bearer(otherAdmin.token)).send({ name: 'TV' }).expect(201);
  });
});

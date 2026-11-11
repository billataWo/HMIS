import { createHmac, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createPrismaClient } from '@hmis/db';
import { BCRYPT_COST } from '../src/common/passwords.js';
import { api, bearer, db, login, makeClinic, makeStaff, makeUser, phone, startApp, stopApp } from './helpers.js';
import { routeInventory } from './routes.inventory.js';

/**
 * The security controls, tested from outside as an attacker would try them: routes without an
 * access rule, unauthenticated and cross-clinic access, wrong roles, malformed input, forged
 * tokens, password storage and the limits on guessing. (Row-level security itself, sign-in limits,
 * two-step sign-in, sync tokens and the console have their own spec files too.)
 */
process.env.HMIS_PLATFORM = '1';
beforeAll(startApp);
afterAll(stopApp);

/** Every public route, reviewed: each one authenticates in its own way or is meant to be open. */
const PUBLIC_ROUTES = [
  'GET /display/queue', // the waiting-room screen's own key
  'GET /display/voice', // the waiting-room screen's own key (the recorded calling voice)
  'GET /health',
  'GET /public/payments/chapa/callback', // only makes HMIS ask Chapa about its own checkout
  'GET /public/plans',
  'GET /sync/export', // a clinic server's sync token
  'GET /sync/licence', // a clinic server's sync token
  'POST /auth/login',
  'POST /auth/login/two-step',
  'POST /display/pair', // a one-time pairing code
  'POST /platform/auth/login',
  'POST /platform/auth/login/two-step',
  'POST /public/clinic-requests', // rate-limited per address, reviewed by HMIS
  'POST /public/payments/chapa/webhook', // signed by Chapa; only triggers a check with Chapa
  'POST /public/payments/telebirr/notify', // signed by telebirr; only triggers a check
  'POST /sync/push', // a clinic server's sync token
].sort();

const withIds = (route: string) => route.replace(/:[A-Za-z]+/g, randomUUID());
const call = (method: string, path: string) => {
  const m = method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
  return api[m](path);
};

describe('access rules', () => {
  it('every route declares who may use it, and the public ones are the reviewed list', () => {
    const routes = routeInventory();
    expect(routes.length).toBeGreaterThan(100);
    // A route with no rule would be refused anyway (the guard denies by default), but it is a bug.
    expect(routes.filter((r) => r.access === 'any-signed-in').map((r) => r.route)).toEqual([]);
    expect(routes.filter((r) => r.access === 'public').map((r) => r.route)).toEqual(PUBLIC_ROUTES);
  });

  it('refuses every clinic and console route without a sign-in', async () => {
    const routes = routeInventory().filter((r) => r.access === 'roles' || r.access === 'platform');
    const answers = await Promise.all(
      routes.map(async (r) => {
        const [method, path] = r.route.split(' ');
        return [r.route, (await call(method, withIds(path))).status] as const;
      }),
    );
    // The sign-in is checked before anything else, so every one of them answers 401.
    expect(answers.filter(([, status]) => status !== 401)).toEqual([]);
  }, 60_000);

  it('refuses forged and tampered tokens', async () => {
    const t = await makeClinic('Token Clinic');
    const admin = await makeUser(t.id, 'ADMIN');
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const claims = { sub: admin.id, tenantId: t.id, role: 'ADMIN', name: 'x', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 };
    // No signature at all.
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
    // The right secret, but another algorithm than the one HMIS uses.
    const head = b64({ alg: 'HS512', typ: 'JWT' });
    const hs512 = `${head}.${b64(claims)}.${createHmac('sha512', process.env.JWT_SECRET!).update(`${head}.${b64(claims)}`).digest('base64url')}`;
    // A guessed secret.
    const head256 = b64({ alg: 'HS256', typ: 'JWT' });
    const guessed = `${head256}.${b64(claims)}.${createHmac('sha256', 'secret').update(`${head256}.${b64(claims)}`).digest('base64url')}`;
    for (const token of [none, hs512, guessed]) await api.get('/auth/me').set(bearer(token)).expect(401);
  });

  it("keeps each role to its own work", async () => {
    const t = await makeClinic('Roles Clinic');
    const cashier = await makeStaff(t.id, 'CASHIER');
    const doctor = await makeStaff(t.id, 'DOCTOR');
    await api.get('/users').set(bearer(cashier.token)).expect(403);
    await api.get('/audit').set(bearer(doctor.token)).expect(403);
    await api.patch('/settings').set(bearer(doctor.token)).send({ name: 'Taken over' }).expect(403);
    await api.post('/users').set(bearer(cashier.token)).send({ fullName: 'New Admin', phone: phone(), role: 'ADMIN', password: 'password123' }).expect(403);
    await api.get('/exports/patients/' + randomUUID()).set(bearer(cashier.token)).expect(403);
  });
});

describe('clinics are isolated from each other', () => {
  it("cannot read or change another clinic's records through the API", async () => {
    const a = await makeClinic('Isolation A');
    const b = await makeClinic('Isolation B');
    const adminA = await makeStaff(a.id, 'ADMIN');
    const adminB = await makeStaff(b.id, 'ADMIN');
    const patient = (await api.post('/patients').set(bearer(adminB.token)).send({ firstName: 'Secret', fatherName: 'Patient', sex: 'FEMALE', ageYears: 30, phone: phone() }).expect(201)).body;
    const service = await db.serviceItem.create({ data: { tenantId: b.id, code: `ISO-${randomUUID().slice(0, 6)}`, name: 'Consultation', kind: 'CONSULTATION', price: 100 } });
    const visit = (await api.post('/visits').set(bearer(adminB.token)).send({ patientId: patient.id, serviceId: service.id }).expect(201)).body;

    await api.get(`/patients/${patient.id}`).set(bearer(adminA.token)).expect(404);
    await api.patch(`/patients/${patient.id}`).set(bearer(adminA.token)).send({ firstName: 'Changed' }).expect(404);
    await api.get(`/visits/${visit.id}`).set(bearer(adminA.token)).expect(404);
    await api.get(`/exports/patients/${patient.id}`).set(bearer(adminA.token)).expect(404);
    const list = (await api.get('/patients?q=Secret').set(bearer(adminA.token)).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(patient.id);
    // A visit for another clinic's patient cannot be created either.
    expect((await api.post('/visits').set(bearer(adminA.token)).send({ patientId: patient.id, serviceId: service.id })).status).toBeGreaterThanOrEqual(400);
    expect((await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).firstName).toBe('Secret');
  });

  it("the application's database role sees no other clinic's rows in any clinic table", async () => {
    const a = await makeClinic('RLS Sweep A');
    const b = await makeClinic('RLS Sweep B');
    await makeUser(b.id, 'NURSE');
    const tables = await db.$queryRawUnsafe<{ t: string }[]>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.oid AND x.attname = 'tenantId')`,
    );
    expect(tables.length).toBeGreaterThan(20);
    const asA = createPrismaClient(process.env.APP_DATABASE_URL, { tenant: () => a.id });
    try {
      for (const { t } of tables) {
        const [r] = await asA.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}" WHERE "tenantId" <> $1`, a.id);
        expect({ table: t, otherClinicsRows: Number(r.n) }).toEqual({ table: t, otherClinicsRows: 0 });
      }
      // Nor can it write a row for another clinic.
      await expect(asA.patient.create({ data: { tenantId: b.id, mrn: `X-${randomUUID().slice(0, 6)}`, firstName: 'Planted', fatherName: 'Row', sex: 'MALE' } })).rejects.toThrow();
    } finally {
      await asA.$disconnect();
    }
  });
});

describe('malformed input', () => {
  it('turns away bad ids, repeated query parameters, wrong types and oversized bodies', async () => {
    const t = await makeClinic('Input Clinic');
    const admin = await makeStaff(t.id, 'ADMIN');
    // A record id must be a UUID: anything else is simply not found, before any query.
    for (const bad of ['1', "1' OR '1'='1", '..%2f..%2fetc', 'x'.repeat(300)]) {
      await api.get(`/patients/${encodeURIComponent(bad)}`).set(bearer(admin.token)).expect(404);
    }
    // ?q=a&q=b would arrive as a list.
    await api.get('/patients?q=a&q=b').set(bearer(admin.token)).expect(400);
    await api.get(`/patients?q=${'x'.repeat(600)}`).set(bearer(admin.token)).expect(400);
    // The schema refuses wrong types and unknown shapes, field by field.
    const res = await api.post('/patients').set(bearer(admin.token)).send({ firstName: 42, sex: 'ROBOT', ageYears: -3 }).expect(400);
    expect(res.body.errors?.length).toBeGreaterThan(0);
    // Not JSON at all, and a body over the size limit.
    await api.post('/patients').set(bearer(admin.token)).set('Content-Type', 'application/json').send('{"firstName": ').expect(400);
    await api.post('/patients').set(bearer(admin.token)).send({ notes: 'x'.repeat(3 * 1024 * 1024) }).expect(413);
    // No stack traces or server details in any answer.
    const notFound = await api.get('/no-such-route').set(bearer(admin.token)).expect(404);
    expect(JSON.stringify(notFound.body)).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
    expect(notFound.headers['x-powered-by']).toBeUndefined();
  });

  it('uses only the price list for charges: a price sent by the client is ignored', async () => {
    const t = await makeClinic('Price Clinic');
    const desk = await makeStaff(t.id, 'RECEPTIONIST');
    const service = await db.serviceItem.create({ data: { tenantId: t.id, code: `PR-${randomUUID().slice(0, 6)}`, name: 'Consultation', kind: 'CONSULTATION', price: 250 } });
    const patient = (await api.post('/patients').set(bearer(desk.token)).send({ firstName: 'Price', fatherName: 'Check', sex: 'MALE', ageYears: 40, phone: phone() }).expect(201)).body;
    const visit = await api.post('/visits').set(bearer(desk.token)).send({ patientId: patient.id, serviceId: service.id, unitPrice: 1, price: 1, amount: 1 });
    expect(visit.status).toBe(201);
    const charges = await db.charge.findMany({ where: { visitId: visit.body.id } });
    expect(charges.map((c) => c.unitPrice.toString())).toEqual(['250']);
  });
});

describe('passwords', () => {
  it('are stored with bcrypt at work factor 12; older hashes are upgraded at the next sign-in', async () => {
    const t = await makeClinic('Hash Clinic');
    const admin = await makeStaff(t.id, 'ADMIN');
    const created = await api.post('/users').set(bearer(admin.token)).send({ fullName: 'New Nurse', phone: phone(), role: 'NURSE', password: 'a-good-password-1' }).expect(201);
    const fresh = await db.user.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(bcrypt.getRounds(fresh.passwordHash)).toBe(BCRYPT_COST);
    expect(fresh.temporaryPasswordExpiresAt).not.toBeNull();
    // A hash from before (work factor 4 in the tests, 10 in old databases) is replaced on sign-in.
    const old = await makeUser(t.id, 'NURSE');
    expect(bcrypt.getRounds(old.passwordHash)).toBeLessThan(BCRYPT_COST);
    await login(old.phone);
    expect(bcrypt.getRounds((await db.user.findUniqueOrThrow({ where: { id: old.id } })).passwordHash)).toBe(BCRYPT_COST);
  });

  it('a temporary password stops working when it expires', async () => {
    const t = await makeClinic('Expiry Clinic');
    const nurse = await makeUser(t.id, 'NURSE');
    await db.user.update({ where: { id: nurse.id }, data: { mustChangePassword: true, temporaryPasswordExpiresAt: new Date(Date.now() - 60_000) } });
    const res = await api.post('/auth/login').send({ phone: nurse.phone, password: 'password123' }).expect(401);
    expect(res.body.message).toMatch(/expired/);
    // Still valid: signs in, and must then choose a password.
    await db.user.update({ where: { id: nurse.id }, data: { temporaryPasswordExpiresAt: new Date(Date.now() + 60_000) } });
    const token = await login(nurse.phone);
    await api.get('/patients').set(bearer(token)).expect(403);
    await api.post('/auth/password').set(bearer(token)).send({ current: 'password123', next: 'my-own-password-1' }).expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: nurse.id } })).temporaryPasswordExpiresAt).toBeNull();
  });

  it('the current password cannot be guessed with a stolen session', async () => {
    const t = await makeClinic('Guess Clinic');
    const nurse = await makeStaff(t.id, 'NURSE');
    for (let i = 0; i < 5; i++) {
      await api.post('/auth/password').set(bearer(nurse.token)).send({ current: `wrong-${i}`, next: 'another-password-1' }).expect(401);
    }
    await api.post('/auth/password').set(bearer(nurse.token)).send({ current: 'password123', next: 'another-password-1' }).expect(429);
    await api.post('/auth/two-step/disable').set(bearer(nurse.token)).send({ password: 'password123' }).expect(429);
  });
});

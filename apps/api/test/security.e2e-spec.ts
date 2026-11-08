import bcrypt from 'bcryptjs';
import { base32Decode, base32Encode, currentStep, hotp } from '../src/auth/totp.js';
import { clientIp } from '../src/common/client-ip.js';
import { api, bearer, db, login, makeClinic, makeStaff, makeUser, phone, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

/** Sign-in from a given address, as the web app passes it on (it runs on this machine: trusted). */
const signIn = (from: string, phoneNumber: string, password: string) => api.post('/auth/login').set('X-Forwarded-For', from).send({ phone: phoneNumber, password });

describe('security', () => {
  let tenantId: string;
  let admin: { id: string; token: string };

  beforeAll(async () => {
    tenantId = (await makeClinic('Security Clinic')).id;
    admin = await makeStaff(tenantId, 'ADMIN');
  });

  it('believes a forwarded address only from the web app on this machine', () => {
    const req = (socket: string, forwarded?: string) => ({ socket: { remoteAddress: socket }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} }) as never;
    expect(clientIp(req('127.0.0.1', '198.51.100.9, 10.0.0.1'))).toBe('198.51.100.9');
    expect(clientIp(req('::ffff:127.0.0.1'))).toBeNull(); // through the web app, address unknown
    expect(clientIp(req('203.0.113.50', '1.2.3.4'))).toBe('203.0.113.50'); // a direct caller can't fake it
  });

  it('stops one address trying a password on many accounts (password spraying)', async () => {
    const attacker = '198.51.100.20';
    for (let i = 0; i < 30; i++) await signIn(attacker, phone(), 'Summer2026!').expect(401);
    const victim = await makeUser(tenantId, 'CASHIER');
    await signIn(attacker, victim.phone, 'password123').expect(429);
    // The clinic's own staff, elsewhere, are not affected.
    await signIn('198.51.100.21', victim.phone, 'password123').expect(200);
  }, 60_000);

  it("locks one account from one address, without letting a stranger lock a colleague out", async () => {
    const user = await makeUser(tenantId, 'NURSE');
    for (let i = 0; i < 5; i++) await signIn('198.51.100.30', user.phone, 'wrong-one').expect(401);
    await signIn('198.51.100.30', user.phone, 'password123').expect(429);
    await signIn('198.51.100.31', user.phone, 'password123').expect(200);
  });

  it('locks an account attacked from many addresses', async () => {
    const user = await makeUser(tenantId, 'NURSE');
    for (let i = 0; i < 20; i++) await signIn(`198.51.100.${100 + i}`, user.phone, 'wrong-one').expect(401);
    await signIn('198.51.100.200', user.phone, 'password123').expect(429);
  });

  it('records sign-ins, failed attempts and lockouts in the audit log, with the address', async () => {
    const user = await makeUser(tenantId, 'DOCTOR');
    await signIn('198.51.100.40', user.phone, 'password123').expect(200);
    for (let i = 0; i < 5; i++) await signIn('198.51.100.41', user.phone, 'nope-nope').expect(401);
    const entries = await db.auditLog.findMany({ where: { tenantId, entityId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['auth.login', ...Array(5).fill('auth.login_failed'), 'auth.locked']);
    expect(entries[0].data).toMatchObject({ ip: '198.51.100.40' });
    expect(entries.at(-1)!.data).toMatchObject({ ip: '198.51.100.41', limits: ['account from this address'] });
  });

  it('ends every other sign-in when the password is changed, and keeps this one going', async () => {
    const user = await makeUser(tenantId, 'RECEPTIONIST');
    const pcA = await login(user.phone);
    const pcB = await login(user.phone);
    await new Promise((r) => setTimeout(r, 1100)); // tokens carry their issue time in whole seconds
    const changed = (await api.post('/auth/password').set(bearer(pcA)).send({ current: 'password123', next: 'a-new-password-1' }).expect(200)).body;
    await api.get('/auth/me').set(bearer(pcA)).expect(401);
    await api.get('/auth/me').set(bearer(pcB)).expect(401);
    await api.get('/auth/me').set(bearer(changed.token)).expect(200);
  });

  it("ends a user's sign-ins when an admin resets their password", async () => {
    const user = await makeUser(tenantId, 'PHARMACIST');
    const token = await login(user.phone);
    await new Promise((r) => setTimeout(r, 1100));
    await api.patch(`/users/${user.id}`).set(bearer(admin.token)).send({ password: 'temporary-22' }).expect(200);
    await api.get('/auth/me').set(bearer(token)).expect(401);
    // The new temporary password works (and must be replaced first).
    const fresh = await login(user.phone, 'temporary-22');
    await api.get('/auth/me').set(bearer(fresh)).expect(200);
  });

  describe('two-step sign-in', () => {
    const totp = async (secret: string, offsetSteps = 0) => hotp(base32Decode(secret), currentStep() + offsetSteps);
    const challengeFor = async (phoneNumber: string, password = 'password123') =>
      (await api.post('/auth/login').send({ phone: phoneNumber, password }).expect(200)).body as { twoStepRequired?: boolean; challenge: string; token?: string };

    it('generates the standard codes (RFC 6238 test value)', () => {
      // Secret "12345678901234567890", time 59 s: 94287082 with 8 digits.
      expect(hotp(Buffer.from('12345678901234567890'), 1, 8)).toBe('94287082');
      expect(base32Decode(base32Encode(Buffer.from('hello')))).toEqual(Buffer.from('hello'));
    });

    it('keeps an admin without it on the setup page, and ends old sign-ins once it is on', async () => {
      const p = phone();
      await db.user.create({ data: { tenantId, phone: p, role: 'ADMIN', fullName: 'New Admin', passwordHash: await bcrypt.hash('password123', 4) } });
      const first = await challengeFor(p);
      expect(first.twoStepRequired).toBeUndefined(); // nothing to ask for yet
      const blocked = await api.get('/users').set(bearer(first.token!)).expect(403);
      expect(blocked.body.code).toBe('TWO_STEP_SETUP_REQUIRED');
      expect((await api.get('/auth/me').set(bearer(first.token!)).expect(200)).body.twoStep).toEqual({ enabled: false, required: true });

      const { secret, uri } = (await api.post('/auth/two-step/setup').set(bearer(first.token!)).send({}).expect(200)).body;
      expect(uri).toMatch(/^otpauth:\/\/totp\/HMIS:/);
      await api.post('/auth/two-step/enable').set(bearer(first.token!)).send({ code: '000000' }).expect(409);
      await new Promise((r) => setTimeout(r, 1100));
      const on = (await api.post('/auth/two-step/enable').set(bearer(first.token!)).send({ code: await totp(secret) }).expect(200)).body;
      expect(on.recoveryCodes).toHaveLength(10);
      await api.get('/users').set(bearer(first.token!)).expect(401); // the old sign-in ended
      await api.get('/users').set(bearer(on.token)).expect(200);
      // Admins cannot switch it off.
      await api.post('/auth/two-step/disable').set(bearer(on.token)).send({ password: 'password123' }).expect(403);
    });

    it('asks for the code after the password; each code works once; wrong codes lock', async () => {
      const admin2 = await makeUser(tenantId, 'ADMIN');
      const c = await challengeFor(admin2.phone);
      expect(c.twoStepRequired).toBe(true);
      expect(c.token).toBeUndefined();
      // The challenge is not a session.
      await api.get('/auth/me').set(bearer(c.challenge)).expect(401);

      const code = await totp(admin2.totpSecret!);
      await api.post('/auth/login/two-step').send({ challenge: c.challenge, code }).expect(200);
      // The same code again (seen over a shoulder): refused.
      const again = await challengeFor(admin2.phone);
      await api.post('/auth/login/two-step').send({ challenge: again.challenge, code }).expect(401);
      for (let i = 0; i < 4; i++) await api.post('/auth/login/two-step').send({ challenge: again.challenge, code: '123456' }).expect(401);
      await api.post('/auth/login/two-step').send({ challenge: again.challenge, code: await totp(admin2.totpSecret!, 1) }).expect(429);
      const audit = await db.auditLog.findMany({ where: { entityId: admin2.id, action: { startsWith: 'auth.' } }, orderBy: { createdAt: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['auth.login', ...Array(4).fill('auth.two_step_failed'), 'auth.locked']);
    });

    it('lets a recovery code in once, and an admin reset ends the sign-ins of a lost phone', async () => {
      const p = phone();
      const user = await db.user.create({ data: { tenantId, phone: p, role: 'ADMIN', fullName: 'Lost Phone', passwordHash: await bcrypt.hash('password123', 4) } });
      const start = (await challengeFor(p)).token!;
      const { secret } = (await api.post('/auth/two-step/setup').set(bearer(start)).send({}).expect(200)).body;
      const { recoveryCodes } = (await api.post('/auth/two-step/enable').set(bearer(start)).send({ code: await totp(secret) }).expect(200)).body;

      const c = await challengeFor(p);
      const viaRecovery = (await api.post('/auth/login/two-step').send({ challenge: c.challenge, code: recoveryCodes[0].toLowerCase() }).expect(200)).body;
      const reuse = await challengeFor(p);
      await api.post('/auth/login/two-step').send({ challenge: reuse.challenge, code: recoveryCodes[0] }).expect(401);
      expect((await api.get('/auth/two-step').set(bearer(viaRecovery.token)).expect(200)).body.recoveryCodesLeft).toBe(9);
      // Moving to another phone needs the password.
      await api.post('/auth/two-step/setup').set(bearer(viaRecovery.token)).send({}).expect(401);

      await new Promise((r) => setTimeout(r, 1100));
      await api.patch(`/users/${user.id}`).set(bearer(admin.token)).send({ resetTwoStep: true }).expect(200);
      await api.get('/auth/me').set(bearer(viaRecovery.token)).expect(401);
      const fresh = await challengeFor(p);
      expect(fresh.twoStepRequired).toBeUndefined(); // signs in with the password, then must set it up again
      expect((await api.get('/users').set(bearer(fresh.token!)).expect(403)).body.code).toBe('TWO_STEP_SETUP_REQUIRED');
    });

    it('is optional for other roles, and needs the password to switch off', async () => {
      const nurse = await makeUser(tenantId, 'NURSE');
      const token = await login(nurse.phone);
      const { secret } = (await api.post('/auth/two-step/setup').set(bearer(token)).send({}).expect(200)).body;
      const on = (await api.post('/auth/two-step/enable').set(bearer(token)).send({ code: await totp(secret) }).expect(200)).body;
      expect((await challengeFor(nurse.phone)).twoStepRequired).toBe(true);
      await api.post('/auth/two-step/disable').set(bearer(on.token)).send({ password: 'wrong' }).expect(401);
      await api.post('/auth/two-step/disable').set(bearer(on.token)).send({ password: 'password123' }).expect(200);
      expect((await challengeFor(nurse.phone)).token).toBeTruthy();
    });
  });

  it('does not reveal the server software', async () => {
    const res = await api.get('/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

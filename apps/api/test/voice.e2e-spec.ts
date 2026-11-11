import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PlatformRole } from '@hmis/db';
import { base32Decode, currentStep, hotp, newSecret } from '../src/auth/totp.js';
import { api, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

process.env.HMIS_PLATFORM = '1';
process.env.HMIS_SCHEDULER = '0';
beforeAll(startApp);
afterAll(stopApp);

const PASSWORD = 'operator-password-1';

async function operator(role: PlatformRole) {
  const op = await db.platformUser.create({
    data: { fullName: `${role} voice`, email: `voice-${randomUUID()}@hmis.test`, role, passwordHash: await bcrypt.hash(PASSWORD, 4), mustChangePassword: false, totpSecret: newSecret(), totpEnabledAt: new Date() },
  });
  const first = await api.post('/platform/auth/login').set('X-Forwarded-For', '10.77.0.1').send({ email: op.email, password: PASSWORD }).expect(200);
  const code = hotp(base32Decode(op.totpSecret!), currentStep());
  return (await api.post('/platform/auth/login/two-step').set('X-Forwarded-For', '10.77.0.1').send({ challenge: first.body.challenge, code }).expect(200)).body.token as string;
}

/** A tiny real WAV file: 0.1 s of a tone, mono 16-bit at 22 kHz. */
function wav(seconds = 0.1) {
  const rate = 22050;
  const n = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2);
  return b;
}

/** One recorded voice for every clinic's waiting-room TVs, kept in the platform console. */
describe('the waiting-room voice', () => {
  let owner: string, billing: string, screenKey: string;

  beforeAll(async () => {
    await db.voiceClip.deleteMany({});
    [owner, billing] = [await operator('OWNER'), await operator('BILLING')];
    const tenantId = (await makeClinic('Voice Clinic')).id;
    const admin = await makeStaff(tenantId, 'ADMIN');
    const { code } = (await api.post('/displays').set(bearer(admin.token)).send({ name: 'Voice TV' }).expect(201)).body;
    screenKey = (await api.post('/display/pair').set('X-Forwarded-For', '198.51.100.77').send({ code }).expect(200)).body.token;
  });
  afterAll(() => db.voiceClip.deleteMany({}));

  it('is recorded by an owner, clip by clip, and only real audio is kept', async () => {
    const put = (token: string, lang: string, key: string, data: string) => api.put(`/platform/voice/${lang}/${key}`).set(bearer(token)).send({ data });
    const tone = wav().toString('base64');

    const saved = (await put(owner, 'am', 'n12', tone).expect(200)).body;
    expect(saved).toMatchObject({ lang: 'am', key: 'n12', mime: 'audio/wav', bytes: wav().length });
    await put(owner, 'en', 'number', tone).expect(200);

    // Other operators can listen, not change it.
    await put(billing, 'am', 'n13', tone).expect(403);
    const pack = (await api.get('/platform/voice').set(bearer(billing)).expect(200)).body;
    expect(pack.format).toBe('hmis-voice-1');
    expect(pack.clips.map((c: { lang: string; key: string }) => `${c.lang}/${c.key}`)).toEqual(['am/n12', 'en/number']);
    expect(Buffer.from(pack.clips[0].data, 'base64').equals(wav())).toBe(true);

    // What it is comes from the bytes: text named as audio, or a page, is refused.
    await put(owner, 'am', 'n13', Buffer.from('<html><script>alert(1)</script></html>').toString('base64')).expect(400);
    // Only the known words, in the two languages.
    await put(owner, 'fr', 'n12', tone).expect(404);
    await put(owner, 'am', 'n21', tone).expect(404);
    await put(owner, 'am', '..%2Fx', tone).expect(404);
    // Not too long.
    await put(owner, 'am', 'n14', wav(10).toString('base64')).expect(400);
    // Not without signing in.
    await api.put('/platform/voice/am/n12').send({ data: tone }).expect(401);

    const ownerId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).sub;
    const history = await db.platformAuditLog.findMany({ where: { entity: 'VoiceClip', operatorId: ownerId } });
    expect(history.map((h) => h.entityId).sort()).toEqual(['am/n12', 'en/number']);
  });

  it('reaches every paired screen, which knows when it changed', async () => {
    const before = (await api.get('/display/queue').set(bearer(screenKey)).expect(200)).body.voice;
    expect(before).toEqual(expect.any(String));
    const pack = (await api.get('/display/voice').set(bearer(screenKey)).expect(200)).body;
    expect(pack.clips).toHaveLength(2);
    await api.get('/display/voice').expect(401);
    await api.get('/display/voice').set(bearer('x'.repeat(48))).expect(401);

    await api.delete('/platform/voice/en/number').set(bearer(billing)).expect(403);
    await api.delete('/platform/voice/en/number').set(bearer(owner)).expect(204);
    await api.delete('/platform/voice/en/number').set(bearer(owner)).expect(404);
    const after = (await api.get('/display/queue').set(bearer(screenKey)).expect(200)).body.voice;
    expect(after).not.toBe(before);

    await api.delete('/platform/voice/am/n12').set(bearer(owner)).expect(204);
    expect((await api.get('/display/queue').set(bearer(screenKey)).expect(200)).body.voice).toBeNull();
  });
});

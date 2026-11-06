import { api, appPrisma, bearer, db, makeClinic, makeStaff, startApp, stopApp } from './helpers.js';

beforeAll(startApp);
afterAll(stopApp);

type Staff = { id: string; token: string };
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const epochAgo = (ms: number) => Math.floor((Date.now() - ms) / 1000);

/** Settings → Backups reads the events the backup worker (deploy/postgres) writes. */
describe('backup status', () => {
  let admin: Staff, doctor: Staff;

  beforeAll(async () => {
    const tenantId = (await makeClinic('Backup Check Clinic')).id;
    [admin, doctor] = await Promise.all([makeStaff(tenantId, 'ADMIN'), makeStaff(tenantId, 'DOCTOR')]);
  });
  beforeEach(() => db.backupEvent.deleteMany());
  afterAll(() => db.backupEvent.deleteMany());

  const status = async () => (await api.get('/backups/status').set(bearer(admin.token)).expect(200)).body;
  const event = (kind: string, status: string, at: Date, extra: object = {}) =>
    db.backupEvent.create({ data: { kind: kind as never, status: status as never, startedAt: at, finishedAt: at, site: 'Test server', ...extra } });

  async function healthy() {
    await event('BACKUP', 'OK', ago(20 * MIN), {
      detail: 'incr',
      sizeBytes: 5_000_000_000n,
      data: { oldestBackupAt: epochAgo(13 * 24 * 60 * MIN), databaseBytes: 80_000_000 },
    });
    await event('CHECK', 'OK', ago(5 * MIN), { data: { offsite: true, offsiteLocation: 'Addis Ababa', archive: true, lastArchivedAt: epochAgo(MIN) } });
    await event('OFFSITE_SYNC', 'OK', ago(10 * MIN), { data: { location: 'Addis Ababa' } });
    await event('RESTORE_TEST', 'OK', ago(2 * 24 * 60 * MIN), { detail: 'local', data: { recoverySeconds: 140, patients: 12, visits: 30 } });
    await event('RESTORE_TEST', 'OK', ago(9 * 24 * 60 * MIN), { detail: 'offsite', data: { recoverySeconds: 400, patients: 12, visits: 30 } });
    await event('VERIFY', 'OK', ago(3 * 24 * 60 * MIN), { message: 'Every file matches' });
    await event('ARCHIVE', 'OK', ago(10 * 24 * 60 * MIN), { detail: 'monthly', message: 'Encrypted monthly archive' });
  }

  it('is for admins only', async () => {
    await api.get('/backups/status').set(bearer(doctor.token)).expect(403);
  });

  it('says so when no backup worker has ever reported', async () => {
    const s = await status();
    expect(s.monitored).toBe(false);
    expect(s.overall).toBe('failing');
    // Development servers have no backup worker: no banner outside production.
    expect(s.banner).toBeNull();
  });

  it('reports a healthy server: recent backup, off-site copy, restore tests, verification, archive', async () => {
    await healthy();
    const s = await status();
    expect(s.overall).toBe('ok');
    expect(s.banner).toBeNull();
    expect(s.checks.map((c: { key: string; status: string }) => [c.key, c.status])).toEqual([
      ['backup', 'ok'],
      ['health', 'ok'],
      ['offsite', 'ok'],
      ['restore-test', 'ok'],
      ['restore-test-offsite', 'ok'],
      ['verify', 'ok'],
      ['archive', 'ok'],
    ]);
    expect(s.offsite).toMatchObject({ configured: true, location: 'Addis Ababa' });
    expect(s.restoreWindow.from).toBeTruthy();
    expect(s.lastRestoreTest).toMatchObject({ ok: true, recoverySeconds: 140 });
    expect(s.recent[0].sizeBytes === null || typeof s.recent[0].sizeBytes === 'number').toBe(true);
    expect(s.recent.find((e: { kind: string }) => e.kind === 'BACKUP').sizeBytes).toBe(5_000_000_000);
  });

  it('fails loudly when backups stop, and when a restore test fails', async () => {
    await healthy();
    await db.backupEvent.deleteMany({ where: { kind: 'BACKUP' } });
    await event('BACKUP', 'OK', ago(30 * 60 * MIN), { detail: 'incr', data: {} });
    let s = await status();
    expect(s.overall).toBe('failing');
    expect(s.checks[0]).toMatchObject({ key: 'backup', status: 'failing' });
    expect(s.banner).toContain('Backups');

    await event('BACKUP', 'OK', ago(MIN), { detail: 'incr', data: {} });
    await event('RESTORE_TEST', 'FAILED', ago(MIN), { detail: 'local', message: 'Failed while restoring: checksum mismatch' });
    s = await status();
    expect(s.checks.find((c: { key: string }) => c.key === 'restore-test')).toMatchObject({ status: 'failing', detail: expect.stringContaining('checksum') });
    expect(s.banner).toContain('restore test');
  });

  it('warns when there is no off-site copy, or it falls behind', async () => {
    await healthy();
    await event('CHECK', 'WARNING', ago(MIN), { message: 'No off-site copy is configured', data: { offsite: false, archive: true } });
    let s = await status();
    expect(s.overall).toBe('warning');
    expect(s.checks.find((c: { key: string }) => c.key === 'offsite')).toMatchObject({ status: 'warning' });
    expect(s.checks.some((c: { key: string }) => c.key === 'restore-test-offsite')).toBe(false);

    await event('CHECK', 'OK', ago(0), { data: { offsite: true, archive: true } });
    await db.backupEvent.deleteMany({ where: { kind: 'OFFSITE_SYNC' } });
    await event('OFFSITE_SYNC', 'OK', ago(3 * 24 * 60 * MIN));
    await event('OFFSITE_SYNC', 'FAILED', ago(MIN), { message: 'network unreachable' });
    s = await status();
    expect(s.checks.find((c: { key: string }) => c.key === 'offsite')).toMatchObject({ status: 'failing' });
  });

  it('cannot be written or altered through the application role', async () => {
    await healthy();
    const app = appPrisma().client;
    await expect(app.backupEvent.create({ data: { kind: 'BACKUP', status: 'OK', startedAt: new Date() } })).rejects.toThrow();
    await expect(app.backupEvent.deleteMany()).rejects.toThrow();
    expect(await db.backupEvent.count()).toBe(7);
  });
});

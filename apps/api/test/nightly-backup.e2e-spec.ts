import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { Decrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import pg from 'pg';
import { createPrismaClient } from '@hmis/db';
import { DumpError, restoreDump } from '../src/backups/dump.js';
import { type NightlyConfig, NightlyBackupService, runNightlyBackup } from '../src/backups/nightly.js';
import { RESTORE_URL } from './global-setup.js';
import { api, bearer, db, makeClinic, makeStaff, nestApp, startApp, stopApp } from './helpers.js';

const SOURCE_URL = process.env.DATABASE_URL!;

/** Just enough of S3 (path style, no signature check) to run the nightly backup against. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  let damage = false;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const [, bucket, ...rest] = u.pathname.split('/');
    const key = decodeURIComponent(rest.join('/'));
    if (bucket !== 'backups') return res.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>');
    if (req.method === 'PUT') {
      if (!req.headers['content-length']) return res.writeHead(411).end('<Error><Code>MissingContentLength</Code></Error>');
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      if (damage) body[body.length - 1] ^= 1;
      objects.set(key, body);
      return res.writeHead(200).end();
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      return res.writeHead(204).end();
    }
    if (req.method === 'GET' && !key && u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') ?? '';
      const items = [...objects].filter(([k]) => k.startsWith(prefix));
      return res
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(`<ListBucketResult>${items.map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    if (req.method === 'GET' && objects.has(key)) return res.writeHead(200).end(objects.get(key));
    res.writeHead(404).end('<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>');
  });
  return {
    objects,
    damageUploads: (on: boolean) => (damage = on),
    start: () => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function decrypt(body: Buffer, identity: string) {
  const d = new Decrypter();
  d.addIdentity(identity);
  return Readable.fromWeb((await d.decrypt(Readable.toWeb(Readable.from([body])) as ReadableStream<Uint8Array>)) as never).pipe(createGunzip());
}

describe('nightly backup (app hosting: dump, encrypt, upload, restore)', { timeout: 120_000 }, () => {
  const s3 = fakeS3();
  const target = createPrismaClient(RESTORE_URL);
  let cfg: NightlyConfig;
  let identity: string;
  let admin: { token: string };
  let tenantId: string;
  let patientId: string;

  beforeAll(async () => {
    await startApp();
    const endpoint = await s3.start();
    identity = await generateX25519Identity();
    cfg = {
      recipients: [await identityToRecipient(identity)],
      s3: { endpoint, bucket: 'backups', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1' },
      prefix: 'hmis-backups/',
      hour: 2,
      keepDays: 30,
      keepMonths: 12,
      site: 'Test storage',
    };
    tenantId = (await makeClinic('Nightly Backup Clinic')).id;
    admin = await makeStaff(tenantId, 'ADMIN');
    // A name with characters COPY must escape: a tab, a newline, a backslash and Amharic.
    patientId = (await db.patient.create({ data: { tenantId, mrn: `NB-${randomUUID().slice(0, 8)}`, firstName: 'Abebe\tthe\\first', fatherName: 'Kebede\nሙሉ', sex: 'MALE' } })).id;
  });
  beforeEach(() => db.backupEvent.deleteMany());
  afterAll(async () => {
    await db.backupEvent.deleteMany();
    await target.$disconnect();
    await s3.stop();
    await stopApp();
  });

  it('makes an encrypted copy the server itself cannot read, checks the upload and records it', async () => {
    const r = await runNightlyBackup(db, SOURCE_URL, cfg);
    expect(r.status).toBe('OK');
    const [key] = [...s3.objects.keys()];
    expect(key).toMatch(/^hmis-backups\/hmis-\d{4}-\d{2}-\d{2}T\d{6}Z\.hmisdump\.gz\.age$/);
    // age format: only the offline key can open it; no patient name is readable in the file.
    const body = s3.objects.get(key)!;
    expect(body.subarray(0, 21).toString()).toBe('age-encryption.org/v1');
    expect(body.includes(Buffer.from('Abebe'))).toBe(false);

    const events = await db.backupEvent.findMany({ orderBy: { finishedAt: 'asc' } });
    expect(events.map((e) => [e.kind, e.status])).toEqual([
      ['VERIFY', 'OK'],
      ['BACKUP', 'OK'],
    ]);
    expect(events[1]).toMatchObject({ detail: 'nightly', site: 'Test storage' });
    expect(Number(events[1].sizeBytes)).toBe(body.length);

    // Settings → Backups: the nightly checks, no banner, the copy as the off-site copy.
    const s = (await api.get('/backups/status').set(bearer(admin.token)).expect(200)).body;
    expect(s.mode).toBe('nightly');
    expect(s.banner).toBeNull();
    expect(s.checks.map((c: { key: string; status: string }) => [c.key, c.status])).toEqual([
      ['backup', 'ok'],
      ['restore-test', 'warning'],
      ['verify', 'ok'],
    ]);
    expect(s.offsite).toMatchObject({ configured: true, location: 'Test storage' });
    expect(s.overall).toBe('warning'); // until a restore drill has been done
  });

  it('restores the copy into another database: every row, escapes intact, triggers back on', async () => {
    await runNightlyBackup(db, SOURCE_URL, cfg);
    const [key] = [...s3.objects.keys()].sort().reverse();
    const summary = await restoreDump(RESTORE_URL, await decrypt(s3.objects.get(key)!, identity));

    expect(summary.rows.Patient).toBeGreaterThan(0);
    const p = await target.patient.findUnique({ where: { id: patientId } });
    expect(p).toMatchObject({ firstName: 'Abebe\tthe\\first', fatherName: 'Kebede\nሙሉ', tenantId });
    // Every table holds exactly the rows the copy says it has.
    const c = new pg.Client({ connectionString: RESTORE_URL });
    await c.connect();
    try {
      for (const [table, n] of Object.entries(summary.rows)) {
        const [{ count }] = (await c.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`)).rows;
        expect([table, Number(count)]).toEqual([table, n]);
      }
      const off = (await c.query(`SELECT tgname FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'D'`)).rows;
      expect(off).toEqual([]);
    } finally {
      await c.end();
    }
  });

  it('refuses a copy for a newer database, and a damaged copy, without changing anything', async () => {
    const before = await target.patient.count();
    const lines = (header: object, ...rest: string[]) => Readable.from([JSON.stringify(header) + '\n' + rest.join('')]);
    const header = { format: 'hmis-dump-1', createdAt: new Date().toISOString(), database: 'x', migrations: ['29990101000000_from_the_future'] };
    await expect(restoreDump(RESTORE_URL, lines(header))).rejects.toThrow(/apply the migrations first/);

    // The row counts at the end do not match what was read: rolled back, Patient rows untouched.
    const ok = { ...header, migrations: [] };
    const damaged = lines(ok, JSON.stringify({ table: 'Tenant', columns: ['id'] }) + '\n', '\\.\n', JSON.stringify({ end: true, rows: { Tenant: 5 }, sequences: {} }) + '\n');
    await expect(restoreDump(RESTORE_URL, damaged)).rejects.toThrow(DumpError);
    expect(await target.patient.count()).toBe(before);
  });

  it('records a failure when the upload arrives damaged, and removes the bad copy', async () => {
    s3.objects.clear();
    s3.damageUploads(true);
    try {
      const r = await runNightlyBackup(db, SOURCE_URL, cfg);
      expect(r.status).toBe('FAILED');
    } finally {
      s3.damageUploads(false);
    }
    expect(s3.objects.size).toBe(0);
    const events = await db.backupEvent.findMany({ orderBy: { finishedAt: 'asc' } });
    expect(events.map((e) => [e.kind, e.status])).toEqual([
      ['VERIFY', 'FAILED'],
      ['BACKUP', 'FAILED'],
    ]);
  });

  it('is due once a night (or right away with no copy yet), not again within the hour after a failure', async () => {
    const svc = nestApp().get(NightlyBackupService);
    (svc as unknown as { cfg: NightlyConfig }).cfg = cfg;
    const night = new Date(2026, 10, 19, 3, 0);
    expect(await svc.due(night)).toBe(true); // nothing yet
    const event = (status: 'OK' | 'FAILED', at: Date) =>
      db.backupEvent.create({ data: { kind: 'BACKUP', status, detail: 'nightly', startedAt: at, finishedAt: at, data: { mode: 'nightly' } } });
    await event('OK', new Date(2026, 10, 19, 2, 5));
    expect(await svc.due(night)).toBe(false); // tonight's copy is made
    expect(await svc.due(new Date(2026, 10, 20, 2, 30))).toBe(true); // the next night
    await event('FAILED', new Date(2026, 10, 20, 2, 31));
    expect(await svc.due(new Date(2026, 10, 20, 3, 0))).toBe(false); // retried an hour later
    expect(await svc.due(new Date(2026, 10, 20, 3, 40))).toBe(true);
  });
});

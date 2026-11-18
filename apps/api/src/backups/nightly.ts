/**
 * The nightly backup, for servers where the HMIS backup service (pgBackRest, deploy/postgres)
 * cannot run: app hosting with a managed database, such as the HMIS cloud on AletCloud.
 *
 * Every night (HMIS_BACKUP_HOUR, default 02:00 server time) the whole database is copied
 * (dump.ts), gzipped and encrypted with age to HMIS_BACKUP_RECIPIENT, the PUBLIC key of a key pair
 * whose private half is kept offline (`node dist/backups/cli.js keygen`): this server can write
 * backups but never read them, so a stolen bucket key or server exposes nothing. The file goes to
 * an S3 bucket (s3.ts), is read back and compared, and old copies are pruned: every night for
 * HMIS_BACKUP_KEEP_DAYS (30) and the first of each month for HMIS_BACKUP_KEEP_MONTHS (12). Each
 * step is recorded as a BackupEvent, so Settings → Backups shows it.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { Encrypter } from 'age-encryption';
import pg from 'pg';
import type { Db } from '@hmis/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { dumpDatabase } from './dump.js';
import { type S3Config, type S3Object, S3Store, s3FromEnv } from './s3.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Only one backup at a time, across every API process on the database. */
const LOCK = 72110002;
export const NIGHTLY = 'nightly';
const log = new Logger('Backups');

export type NightlyConfig = { recipients: string[]; s3: S3Config; prefix: string; hour: number; keepDays: number; keepMonths: number; site: string };

export function nightlyFromEnv(env: NodeJS.ProcessEnv = process.env): NightlyConfig | null {
  const recipients = (env.HMIS_BACKUP_RECIPIENT ?? '').split(/[\s,]+/).filter(Boolean);
  const s3 = s3FromEnv(env);
  if (!recipients.length || !s3) return null;
  const bad = recipients.find((r) => !/^age1[0-9a-z]+$/.test(r));
  if (bad) throw new Error(`HMIS_BACKUP_RECIPIENT: "${bad.slice(0, 12)}…" is not an age public key (age1…)`);
  const int = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return v && Number.isInteger(n) && n >= min && n <= max ? n : d;
  };
  let prefix = env.HMIS_BACKUP_S3_PREFIX ?? 'hmis-backups/';
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  return {
    recipients,
    s3,
    prefix,
    hour: int(env.HMIS_BACKUP_HOUR, 2, 0, 23),
    keepDays: int(env.HMIS_BACKUP_KEEP_DAYS, 30, 1, 3650),
    keepMonths: int(env.HMIS_BACKUP_KEEP_MONTHS, 12, 0, 1200),
    site: env.HMIS_BACKUP_SITE || new S3Store(s3).location,
  };
}

// hmis-2026-11-19T020000Z.hmisdump.gz.age (UTC)
const NAME = /hmis-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.hmisdump\.gz\.age$/;
export const backupName = (at: Date) => `hmis-${at.toISOString().slice(0, 19).replace(/:/g, '')}Z.hmisdump.gz.age`;
export function backupTime(key: string) {
  const m = NAME.exec(key);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/**
 * Which copies to delete: kept are every copy of the last `keepDays` days, the first copy of each
 * of the last `keepMonths` months (this one included) and, always, the newest. Files that are not
 * nightly copies are never touched.
 */
export function prunable(objects: S3Object[], now: Date, keepDays: number, keepMonths: number): S3Object[] {
  const dated = objects.map((o) => ({ o, at: backupTime(o.key) })).filter((x): x is { o: S3Object; at: Date } => !!x.at);
  if (!dated.length) return [];
  dated.sort((a, b) => a.at.getTime() - b.at.getTime());
  const keep = new Set<string>([dated[dated.length - 1].o.key]);
  const since = now.getTime() - keepDays * DAY;
  const month = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const firstOfMonth = new Map<number, string>();
  for (const { o, at } of dated) {
    if (at.getTime() >= since) keep.add(o.key);
    if (!firstOfMonth.has(month(at))) firstOfMonth.set(month(at), o.key);
  }
  for (const [m, key] of firstOfMonth) if (month(now) - m < keepMonths) keep.add(key);
  return dated.filter(({ o }) => !keep.has(o.key)).map(({ o }) => o);
}

/** The scheduled time of the most recent night: today at `hour` (server time), or yesterday's. */
export function lastScheduled(now: Date, hour: number) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  return d;
}

const human = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function sha256(stream: Readable) {
  const h = createHash('sha256');
  for await (const chunk of stream) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** PostgreSQL's "too many connections" (53300), also "remaining connection slots are reserved". */
const isFull = (e: unknown) => (e as { code?: string })?.code === '53300' || /too many clients|connection slots are reserved/i.test(String((e as Error)?.message));

/**
 * The backup's own connection. A small managed database (AletCloud's free plan: 10 connections,
 * some reserved for the provider) can be full for a moment while the app is busy: wait and try
 * again, `retry.times` times, before giving up for this hour.
 */
export async function connectWhenFree(url: string, retry = { times: 6, waitMs: 20_000 }) {
  for (let attempt = 0; ; attempt++) {
    const client = new pg.Client({ connectionString: url, application_name: 'hmis-backup' });
    try {
      await client.connect();
      return client;
    } catch (e) {
      await client.end().catch(() => undefined);
      if (!isFull(e) || attempt >= retry.times) throw e;
      log.warn(`Database full (no free connection); trying again in ${Math.round(retry.waitMs / 1000)} s`);
      await new Promise((r) => setTimeout(r, retry.waitMs));
    }
  }
}

export type NightlyResult = { status: 'OK'; key: string; sizeBytes: number; totalRows: number; deleted: number } | { status: 'SKIPPED' } | { status: 'FAILED'; error: string };

/**
 * One backup now. `db` records the events (the system client); `url` is the owner connection the
 * copy is read with. Never throws: a failure is recorded and returned.
 */
export async function runNightlyBackup(db: Db, url: string, cfg: NightlyConfig, now = new Date(), retry?: { times: number; waitMs: number }): Promise<NightlyResult> {
  let client: pg.Client | undefined;
  const startedAt = new Date();
  const store = new S3Store(cfg.s3);
  const name = backupName(now);
  const key = cfg.prefix + name;
  let dir: string | undefined;
  try {
    client = await connectWhenFree(url, retry);
    const [{ locked }] = (await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [LOCK])).rows;
    if (!locked) return { status: 'SKIPPED' };

    // 1. The copy: dump → gzip → age → file, hashed on the way.
    dir = await mkdtemp(path.join(tmpdir(), 'hmis-backup-'));
    const file = path.join(dir, name);
    const plain = new PassThrough({ highWaterMark: 1 << 20 });
    const encrypter = new Encrypter();
    for (const r of cfg.recipients) encrypter.addRecipient(r);
    const gzip = createGzip({ level: 6 });
    const encrypted = Readable.fromWeb((await encrypter.encrypt(Readable.toWeb(plain.pipe(gzip)) as ReadableStream<Uint8Array>)) as never);
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const written = pipeline(
      encrypted,
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          sizeBytes += chunk.length;
          done(null, chunk);
        },
      }),
      createWriteStream(file),
    );
    let summary;
    try {
      summary = await dumpDatabase(url, plain, { client });
      plain.end();
    } catch (e) {
      plain.destroy(e as Error);
      await written.catch(() => undefined);
      throw e;
    }
    await written;
    const digest = hash.digest('hex');

    // 2. Off-site: upload, then read it back and compare.
    await store.putFile(key, file);
    const back = await sha256(await store.get(key));
    const verified = back === digest;
    await db.backupEvent.create({
      data: {
        kind: 'VERIFY',
        status: verified ? 'OK' : 'FAILED',
        detail: NIGHTLY,
        message: verified ? `The copy in ${cfg.site} matches what was written (SHA-256).` : `The copy in ${cfg.site} does not match what was written: the upload was damaged.`,
        site: cfg.site,
        startedAt,
        data: { key, sha256: digest },
      },
    });
    if (!verified) {
      await store.delete(key).catch(() => undefined);
      throw new Error(`The uploaded copy ${name} does not match (SHA-256); it will be made again.`);
    }

    // 3. Retention.
    let objects = await store.list(cfg.prefix);
    const old = prunable(objects, now, cfg.keepDays, cfg.keepMonths);
    for (const o of old) await store.delete(o.key);
    objects = objects.filter((o) => !old.includes(o));
    const oldest = objects.map((o) => backupTime(o.key)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? now;

    await db.backupEvent.create({
      data: {
        kind: 'BACKUP',
        status: 'OK',
        detail: NIGHTLY,
        message: `Nightly copy ${name} (${human(sizeBytes)}, ${summary.totalRows} rows), encrypted, stored in ${cfg.site}.${old.length ? ` ${old.length} older ${old.length === 1 ? 'copy' : 'copies'} removed.` : ''}`,
        sizeBytes: BigInt(sizeBytes),
        site: cfg.site,
        startedAt,
        data: {
          mode: NIGHTLY,
          key,
          sha256: digest,
          databaseBytes: summary.databaseBytes,
          totalRows: summary.totalRows,
          tables: Object.keys(summary.rows).length,
          oldestBackupAt: Math.floor(oldest.getTime() / 1000),
          copies: objects.length,
          keepDays: cfg.keepDays,
          keepMonths: cfg.keepMonths,
        },
      },
    });
    log.log(`Nightly backup ${name}: ${human(sizeBytes)}, ${summary.totalRows} rows, ${objects.length} copies kept`);
    return { status: 'OK', key, sizeBytes, totalRows: summary.totalRows, deleted: old.length };
  } catch (e) {
    log.error(`Nightly backup failed: ${message(e)}`);
    await db.backupEvent
      .create({ data: { kind: 'BACKUP', status: 'FAILED', detail: NIGHTLY, message: message(e), site: cfg.site, startedAt, data: { mode: NIGHTLY } } })
      .catch((err: Error) => log.error(`Could not record the failure: ${err.message}`));
    return { status: 'FAILED', error: message(e) };
  } finally {
    await client?.end().catch(() => undefined);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Runs the nightly backup when it is due: after HMIS_BACKUP_HOUR, if tonight's copy has not been
 * made (also right after the first start, and after a night the server was down). A failed
 * attempt is retried an hour later. HMIS_SCHEDULER=0 turns it off (tests run it directly).
 */
@Injectable()
export class NightlyBackupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private cfg: NightlyConfig | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.HMIS_SCHEDULER === '0') return;
    try {
      this.cfg = nightlyFromEnv();
    } catch (e) {
      log.error(`Nightly backup is off: ${message(e)}`);
      return;
    }
    if (!this.cfg || !process.env.DATABASE_URL) return;
    log.log(`Nightly backup on: ${this.cfg.site}, at ${String(this.cfg.hour).padStart(2, '0')}:00`);
    this.timer = setInterval(() => void this.tick(), 10 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.tick(), 2 * 60_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async due(now = new Date()) {
    const db = this.prisma.system.backupEvent;
    const [ok, last] = await Promise.all([
      db.findFirst({ where: { kind: 'BACKUP', detail: NIGHTLY, status: 'OK' }, orderBy: { startedAt: 'desc' } }),
      db.findFirst({ where: { kind: 'BACKUP', detail: NIGHTLY }, orderBy: { finishedAt: 'desc' } }),
    ]);
    const missing = !ok || ok.startedAt < lastScheduled(now, this.cfg!.hour);
    return missing && (!last || now.getTime() - last.finishedAt.getTime() >= HOUR);
  }

  async tick() {
    if (this.running || !this.cfg) return;
    this.running = true;
    try {
      if (await this.due()) await runNightlyBackup(this.prisma.system, process.env.DATABASE_URL!, this.cfg);
    } catch (e) {
      log.error(`Nightly backup check failed: ${message(e)}`);
    } finally {
      this.running = false;
    }
  }
}

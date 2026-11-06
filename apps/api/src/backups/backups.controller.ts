import { Controller, Get } from '@nestjs/common';
import type { BackupEvent, BackupEventKind } from '@hmis/db';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type CheckStatus = 'ok' | 'warning' | 'failing';
type Check = { key: string; label: string; status: CheckStatus; detail: string; at: string | null };
type EventData = Record<string, unknown>;

const RANK: Record<CheckStatus, number> = { ok: 0, warning: 1, failing: 2 };
const worst = (checks: Check[]): CheckStatus => checks.reduce<CheckStatus>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'ok');
const age = (e: BackupEvent | null) => (e ? Date.now() - e.finishedAt.getTime() : Infinity);
const data = (e: BackupEvent | null) => (e?.data ?? {}) as EventData;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const epoch = (v: unknown) => (num(v) ? new Date((v as number) * 1000).toISOString() : null);
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const hours = (ms: number) =>
  ms < 2 * HOUR ? plural(Math.max(1, Math.round(ms / 60_000)), 'minute') : ms < 2 * DAY ? plural(Math.round(ms / HOUR), 'hour') : plural(Math.round(ms / DAY), 'day');

/** One line for the banner: the first failing check and what is wrong with it. */
function backupProblem(checks: Check[]) {
  const c = checks.find((x) => x.status === 'failing');
  return c ? `Backup problem: ${c.label}. ${c.detail}` : null;
}

function serialize(e: BackupEvent) {
  return { ...e, sizeBytes: e.sizeBytes === null ? null : Number(e.sizeBytes) };
}

/**
 * Backup health for Settings → Backups, from the events the backup worker records
 * (deploy/postgres/scripts). Read-only: backups and restores are run on the server, never from
 * the app. Covers the whole server, so every clinic admin on it sees the same picture.
 */
@Controller('backups')
@Roles('ADMIN')
export class BackupsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('status')
  async status() {
    const db = this.prisma.client.backupEvent;
    const latest = (kind: BackupEventKind, extra: { status?: 'OK' | 'FAILED'; detail?: string } = {}) =>
      db.findFirst({ where: { kind, ...extra }, orderBy: { finishedAt: 'desc' } });
    const [backupOk, backupAny, syncOk, syncAny, check, testLocal, testOffsite, verify, archiveOk, archiveAny, restore, recent, total] =
      await Promise.all([
        latest('BACKUP', { status: 'OK' }),
        latest('BACKUP'),
        latest('OFFSITE_SYNC', { status: 'OK' }),
        latest('OFFSITE_SYNC'),
        latest('CHECK'),
        latest('RESTORE_TEST', { detail: 'local' }),
        latest('RESTORE_TEST', { detail: 'offsite' }),
        latest('VERIFY'),
        latest('ARCHIVE', { status: 'OK' }),
        latest('ARCHIVE'),
        latest('RESTORE'),
        db.findMany({ orderBy: { finishedAt: 'desc' }, take: 25 }),
        db.count(),
      ]);

    const health = data(check);
    const offsiteConfigured = health.offsite !== false;
    const archiveConfigured = health.archive !== false;
    const checks: Check[] = [];

    // 1. Backups are being taken (hourly incrementals are the heartbeat of the backup worker).
    if (!backupOk) {
      checks.push({
        key: 'backup',
        label: 'Backups',
        status: 'failing',
        detail: backupAny ? `No backup has succeeded yet: ${backupAny.message ?? 'see the server log'}` : 'No backup has been made on this server yet.',
        at: backupAny?.finishedAt.toISOString() ?? null,
      });
    } else {
      const a = age(backupOk);
      const failedSince = backupAny && backupAny.status === 'FAILED' && backupAny.finishedAt > backupOk.finishedAt;
      checks.push({
        key: 'backup',
        label: 'Backups',
        status: a > 26 * HOUR ? 'failing' : a > 3 * HOUR || failedSince ? 'warning' : 'ok',
        detail:
          a > 26 * HOUR
            ? `The last backup was ${hours(a)} ago. The backup worker may be stopped.`
            : failedSince
              ? `The last attempt failed (${backupAny.message ?? 'see the server log'}); the previous backup is ${hours(a)} old.`
              : `Last ${backupOk.detail ?? ''} backup ${hours(a)} ago.`,
        at: backupOk.finishedAt.toISOString(),
      });
    }

    // 2. Server health: WAL archiving (the last minute of work), disk space, settings.
    if (check) {
      checks.push({
        key: 'health',
        label: 'Continuous archiving and disk space',
        status: check.status === 'FAILED' ? 'failing' : check.status === 'WARNING' ? 'warning' : 'ok',
        detail: check.message ?? '',
        at: check.finishedAt.toISOString(),
      });
    }

    // 3. The off-site copy (the "1" in 3-2-1).
    if (!offsiteConfigured) {
      checks.push({ key: 'offsite', label: 'Off-site copy', status: 'warning', detail: 'No off-site storage is configured, so a fire or theft would take the backups too.', at: null });
    } else {
      const a = age(syncOk);
      checks.push({
        key: 'offsite',
        label: 'Off-site copy',
        status: a > 48 * HOUR ? 'failing' : a > 6 * HOUR ? 'warning' : 'ok',
        detail: syncOk
          ? `Copied to ${(data(syncOk).location as string) || 'off-site storage'} ${hours(a)} ago.${syncAny?.status === 'FAILED' && syncAny.finishedAt > syncOk.finishedAt ? ' The latest attempt failed (usually the internet connection); it retries every few minutes.' : ''}`
          : 'Nothing has reached off-site storage yet.',
        at: syncOk?.finishedAt.toISOString() ?? null,
      });
    }

    // 4. Restore tests: the proof that the backups can actually be restored.
    const restoreTest = (e: BackupEvent | null, label: string, maxDays: number, key: string) => {
      const d = data(e);
      checks.push({
        key,
        label,
        status: !e ? 'warning' : e.status === 'FAILED' ? 'failing' : age(e) > maxDays * DAY ? 'warning' : 'ok',
        detail: !e
          ? 'Not run yet.'
          : e.status === 'FAILED'
            ? (e.message ?? 'Failed.')
            : `${age(e) > maxDays * DAY ? `Last passed ${hours(age(e))} ago. ` : ''}Restored in ${Math.max(1, Math.round((num(d.recoverySeconds) ?? 0) / 60))} min with ${num(d.patients) ?? '?'} patients and ${num(d.visits) ?? '?'} visits; no corruption found.`,
        at: e?.finishedAt.toISOString() ?? null,
      });
    };
    restoreTest(testLocal, 'Weekly restore test', 8, 'restore-test');
    if (offsiteConfigured) restoreTest(testOffsite, 'Monthly restore test from the off-site copy', 35, 'restore-test-offsite');

    // 5. Repository verification (bit rot, failing disk, tampering).
    checks.push({
      key: 'verify',
      label: 'Backup files verified',
      status: !verify ? 'warning' : verify.status === 'FAILED' ? 'failing' : age(verify) > 8 * DAY ? 'warning' : 'ok',
      detail: !verify ? 'Not run yet.' : (verify.message ?? ''),
      at: verify?.finishedAt.toISOString() ?? null,
    });

    // 6. The long-term archive (monthly, readable by future PostgreSQL versions).
    checks.push({
      key: 'archive',
      label: 'Monthly long-term archive',
      status: !archiveConfigured ? 'warning' : archiveAny?.status === 'FAILED' ? 'warning' : !archiveOk ? 'warning' : age(archiveOk) > 35 * DAY ? 'warning' : 'ok',
      detail: !archiveConfigured
        ? 'Not set up (no archive key).'
        : archiveAny?.status === 'FAILED'
          ? (archiveAny.message ?? 'The last archive failed.')
          : archiveOk
            ? (archiveOk.message ?? '')
            : 'Not made yet.',
      at: archiveOk?.finishedAt.toISOString() ?? null,
    });

    const monitored = total > 0;
    const overall: CheckStatus = monitored ? worst(checks) : 'failing';
    const backupData = data(backupOk);
    const expected = monitored || process.env.NODE_ENV === 'production';
    return {
      monitored,
      overall,
      // A banner across the app for admins, only when something needs action now.
      banner: !expected
        ? null
        : !monitored
          ? 'Backups are not running on this server.'
          : overall === 'failing'
            ? backupProblem(checks)
            : null,
      site: backupOk?.site ?? check?.site ?? null,
      lastBackup: backupOk && { at: backupOk.finishedAt.toISOString(), type: backupOk.detail, databaseBytes: num(backupData.databaseBytes) },
      restoreWindow: backupOk && {
        from: epoch(backupData.oldestBackupAt),
        to: epoch(health.lastArchivedAt) ?? backupOk.finishedAt.toISOString(),
      },
      offsite: { configured: offsiteConfigured, location: (health.offsiteLocation as string) || null, lastCopiedAt: syncOk?.finishedAt.toISOString() ?? null },
      lastRestoreTest: testLocal && { at: testLocal.finishedAt.toISOString(), ok: testLocal.status === 'OK', recoverySeconds: num(data(testLocal).recoverySeconds) },
      lastRestore: restore && { at: restore.finishedAt.toISOString(), message: restore.message },
      checks,
      recent: recent.map(serialize),
    };
  }
}

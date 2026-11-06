import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ackOutbox, type Change, type Raw, readOutbox, schemaVersion } from './engine.js';

export type PushResult = { ok: true; applied: number } | { ok: false; status: number; message: string };
export type Transport = (body: { edgeVersion: string; changes: Change[] }) => Promise<PushResult>;

/** Sends a batch to the cloud over HTTPS. */
export function httpTransport(cloudUrl: string, token: string): Transport {
  const url = `${cloudUrl.replace(/\/+$/, '')}/sync/push`;
  return async (body) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const json = (await res.json().catch(() => ({}))) as { applied?: number; message?: string | string[] };
      if (res.ok) return { ok: true, applied: json.applied ?? 0 };
      return { ok: false, status: res.status, message: [json.message].flat().join('; ') || res.statusText };
    } catch (e) {
      return { ok: false, status: 0, message: `Cannot reach the cloud: ${(e as Error).message}` };
    }
  };
}

/**
 * One round: send the oldest ready changes, delete them once the cloud has applied them, record
 * the outcome. With nothing to send it still calls in (an empty batch), so the cloud knows the
 * clinic server is alive and its copy is current (the agent does that once a minute).
 */
export async function pushOnce(owner: Raw, transport: Transport, { heartbeat = true } = {}): Promise<{ sent: number; ok: boolean; idle?: boolean; message?: string }> {
  const changes = await readOutbox(owner);
  if (!changes.length && !heartbeat) return { sent: 0, ok: true, idle: true };
  const result = await transport({ edgeVersion: await schemaVersion(owner), changes });
  if (result.ok) {
    await ackOutbox(
      owner,
      changes.map((c) => c.seq),
    );
    await owner.$executeRawUnsafe(
      `UPDATE "SyncState" SET "lastPushAt" = now(), "lastError" = NULL, "pushedRows" = "pushedRows" + $1 WHERE "id" = 1`,
      changes.length,
    );
    return { sent: changes.length, ok: true };
  }
  await owner.$executeRawUnsafe(`UPDATE "SyncState" SET "lastError" = $1, "lastErrorAt" = now() WHERE "id" = 1`, result.message.slice(0, 1000));
  return { sent: 0, ok: false, message: result.message };
}

/**
 * On a clinic server (SYNC_CLOUD_URL and SYNC_TOKEN set, capture enabled with `sync enable`):
 * sends captured changes to the cloud every few seconds while there is a connection, and keeps
 * them safely in the outbox while there isn't. Waits longer after each failure, up to 5 minutes.
 */
@Injectable()
export class SyncAgent implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Sync');
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private failures = 0;
  private lastContact = 0;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    const url = process.env.SYNC_CLOUD_URL;
    const token = process.env.SYNC_TOKEN;
    if (!url || !token) return;
    const transport = httpTransport(url, token);
    const interval = Number(process.env.SYNC_INTERVAL_MS ?? 5000);
    this.log.log(`Sending changes to ${url}`);
    const run = async () => {
      if (this.stopped) return;
      let delay = interval;
      try {
        const state = await this.prisma.system.syncState.findUnique({ where: { id: 1 } });
        if (state?.enabled) {
          const r = await pushOnce(this.prisma.system, transport, { heartbeat: Date.now() - this.lastContact >= 60_000 });
          if (r.ok) {
            if (!r.idle) this.lastContact = Date.now();
            if (this.failures) this.log.log('Connected to the cloud again');
            this.failures = 0;
            if (r.sent > 0) delay = 200; // more may be waiting
          } else {
            this.failures++;
            if (this.failures === 1 || this.failures % 20 === 0) this.log.warn(r.message ?? 'Sync failed');
            delay = Math.min(300_000, interval * 2 ** Math.min(this.failures, 6));
          }
        } else {
          delay = 60_000; // not enabled yet: check now and then
        }
      } catch (e) {
        this.failures++;
        this.log.error(`Sync round failed: ${(e as Error).message}`);
        delay = Math.min(300_000, interval * 2 ** Math.min(this.failures, 6));
      }
      if (!this.stopped) this.timer = setTimeout(() => void run(), delay);
    };
    this.timer = setTimeout(() => void run(), 1000);
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

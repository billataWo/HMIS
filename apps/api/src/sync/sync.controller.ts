import { Body, ConflictException, Controller, Get, Headers, HttpCode, NotFoundException, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public } from '../auth/auth.decorators.js';
import { tenantContext } from '../common/tenant-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { issueLicence } from '../licence/licence.js';
import { platformEnabled } from '../platform/platform-auth.js';
import { applyChanges, exportRows, hashToken, loadTables, schemaVersion, SyncError, type Tables } from './engine.js';

const PushSchema = z.object({
  edgeVersion: z.string().max(200),
  changes: z
    .array(
      z.object({
        seq: z.string().regex(/^\d{1,19}$/),
        table: z.string().min(1).max(63),
        op: z.enum(['U', 'D']),
        key: z.string().max(10_000),
        row: z.string().max(2_000_000).nullable(),
      }),
    )
    .max(5000),
});

let tableCache: { at: number; tables: Tables } | null = null;

/**
 * Clinic server → cloud sync. On the cloud: /sync/push receives a clinic server's changes and
 * /sync/export hands a clinic's data to a new clinic server; both authenticate with the clinic
 * server's sync token, not a staff sign-in. On any server: /sync/status for the app.
 */
@Controller('sync')
export class SyncController {
  constructor(private readonly prisma: PrismaService) {}

  private async tables(): Promise<Tables> {
    if (!tableCache || Date.now() - tableCache.at > 300_000) tableCache = { at: Date.now(), tables: await loadTables(this.prisma.system) };
    return tableCache.tables;
  }

  /** The clinic server behind a sync token; its clinic is the only one it may write. */
  private async client(authorization: string | undefined) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (token.length < 32) throw new UnauthorizedException('Missing sync token');
    const client = await this.prisma.system.syncClient.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!client || client.revokedAt) throw new UnauthorizedException('This sync token is not valid');
    return client;
  }

  @Public()
  @Post('push')
  @HttpCode(200)
  async push(@Headers('authorization') authorization: string | undefined, @Body(new ZodPipe(PushSchema)) body: z.infer<typeof PushSchema>) {
    const client = await this.client(authorization);
    const cloudVersion = await schemaVersion(this.prisma.system);
    // Upgrade the cloud first, then the clinic servers: a newer clinic server may send tables or
    // columns the cloud doesn't have yet.
    if (body.edgeVersion > cloudVersion) {
      throw new ConflictException({ message: `The cloud is on ${cloudVersion}, the clinic server on ${body.edgeVersion}: update the cloud first`, code: 'CLOUD_OUTDATED' });
    }
    const lastSeq = body.changes.reduce<string | null>((m, c) => (m === null || BigInt(c.seq) > BigInt(m) ? c.seq : m), null);
    try {
      const tables = await this.tables();
      // Applied as the restricted role inside the clinic's tenant context: row-level security
      // refuses any row that isn't this clinic's, whatever the clinic server sends.
      const applied = body.changes.length
        ? await tenantContext.run({ tenantId: client.tenantId }, () =>
            this.prisma.client.$transaction((tx) => applyChanges(tx, tables, body.changes), { timeout: 120_000, maxWait: 15_000 }),
          )
        : 0;
      await this.prisma.system.syncClient.update({
        where: { id: client.id },
        data: {
          lastSeenAt: new Date(),
          lastError: null,
          edgeVersion: body.edgeVersion,
          ...(applied && { appliedRows: { increment: applied }, lastSeq: lastSeq === null ? undefined : BigInt(lastSeq) }),
        },
      });
      return { applied, lastSeq };
    } catch (e) {
      const message = e instanceof SyncError ? e.message : `Could not apply the changes: ${(e as Error).message.split('\n').slice(-1)[0]}`;
      await this.prisma.system.syncClient.update({ where: { id: client.id }, data: { lastSeenAt: new Date(), lastError: message.slice(0, 1000) } });
      throw new ConflictException({ message, code: e instanceof SyncError ? e.code : 'APPLY_FAILED' });
    }
  }

  /** The whole clinic as JSON lines, parents first: for setting up its clinic server. */
  @Public()
  @Get('export')
  async export(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    const client = await this.client(authorization);
    const tables = await this.tables();
    res.setHeader('content-type', 'application/x-ndjson');
    res.write(`${JSON.stringify({ type: 'meta', tenantId: client.tenantId, version: await schemaVersion(this.prisma.system) })}\n`);
    let rows = 0;
    await tenantContext.run({ tenantId: client.tenantId }, async () => {
      for await (const { table, row } of exportRows(this.prisma.client, tables)) {
        res.write(`{"type":"row","table":${JSON.stringify(table)},"row":${row}}\n`);
        rows++;
      }
    });
    res.end(`${JSON.stringify({ type: 'end', rows })}\n`);
  }

  /** The clinic server's HMIS licence, fresh from its subscription (fetched every hour). */
  @Public()
  @Get('licence')
  async licence(@Headers('authorization') authorization: string | undefined) {
    const client = await this.client(authorization);
    if (!platformEnabled() || !(await this.prisma.system.subscription.findUnique({ where: { tenantId: client.tenantId } }))) {
      throw new NotFoundException('This cloud issues no licence for this clinic');
    }
    const { text } = await issueLicence(this.prisma.system, client.tenantId);
    return { licence: text };
  }

  /**
   * How this clinic's data moves, for any signed-in user (the app shows a notice on read-only
   * cloud copies); the details for admins.
   *  - clinic-server: this server is where the clinic works, and sends its changes to the cloud
   *  - cloud-copy: this is the cloud's read-only copy of a clinic that works on its clinic server
   *  - off: neither (a cloud-only clinic, or no sync set up)
   */
  @Get('status')
  async status(@CurrentUser() me: AuthUser) {
    const admin = me.role === 'ADMIN';
    const clients = await this.prisma.system.syncClient.findMany({ where: { tenantId: me.tenantId, revokedAt: null }, orderBy: { createdAt: 'asc' } });
    if (clients.length) {
      const lastSeenAt = clients.reduce<Date | null>((m, c) => (c.lastSeenAt && (!m || c.lastSeenAt > m) ? c.lastSeenAt : m), null);
      return {
        mode: 'cloud-copy' as const,
        lastSyncAt: lastSeenAt?.toISOString() ?? null,
        ...(admin && {
          clients: clients.map((c) => ({
            name: c.name,
            lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
            appliedRows: Number(c.appliedRows),
            lastError: c.lastError,
            edgeVersion: c.edgeVersion,
          })),
        }),
      };
    }
    const state = await this.prisma.system.syncState.findUnique({ where: { id: 1 } });
    if (!state?.enabled) return { mode: 'off' as const, lastSyncAt: null };
    const [backlog] = await this.prisma.system.$queryRawUnsafe<{ n: bigint; oldest: Date | null }[]>(`SELECT count(*) AS n, min("at") AS oldest FROM "SyncOutbox"`);
    return {
      mode: 'clinic-server' as const,
      lastSyncAt: state.lastPushAt?.toISOString() ?? null,
      ...(admin && {
        cloudUrl: process.env.SYNC_CLOUD_URL ?? null,
        enabledAt: state.enabledAt?.toISOString() ?? null,
        pushedRows: Number(state.pushedRows),
        lastError: state.lastError,
        lastErrorAt: state.lastErrorAt?.toISOString() ?? null,
        waiting: Number(backlog?.n ?? 0),
        oldestWaitingAt: backlog?.oldest?.toISOString() ?? null,
      }),
    };
  }
}


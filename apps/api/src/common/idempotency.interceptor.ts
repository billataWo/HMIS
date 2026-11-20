import { CallHandler, ConflictException, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Db, Prisma } from '@hmis/db';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { tenantContext } from './tenant-context.js';

const KEY = /^[A-Za-z0-9:_-]{8,100}$/;
const KEEP_DAYS = 14;
/** A request still "being processed" after this long died half way: its outcome is unknown. */
const STALE_MS = 2 * 60_000;
// IdempotentRequest.status: 0 while the request runs, -1 when it failed unexpectedly (it may or
// may not have been saved), otherwise the HTTP status of the stored reply.
const RUNNING = 0;
const UNKNOWN = -1;
let lastPrune = 0;

type Key = { tenantId: string; key: string; userId: string; method: string; path: string };

/**
 * Work replayed from the browser's offline queue carries an Idempotency-Key, so a resend (the
 * connection dropped before the browser heard back, or two tabs sent the same work at once) is
 * applied exactly once:
 *
 * - The key is claimed (inserted) *before* the work runs; the primary key makes a second claim
 *   fail, so two identical requests can never both run.
 * - A repeat after success gets the stored reply. A repeat while the first is still running is
 *   told to try again shortly (IDEMPOTENCY_IN_PROGRESS).
 * - A refusal (4xx) happens before anything is saved, so the claim is dropped and the same
 *   request can be sent again once the cause is fixed. An unexpected failure might have
 *   happened after the work was saved, so that key answers IDEMPOTENCY_UNKNOWN: a person checks.
 *
 * Runs inside the tenant context: claims and replies are per clinic (row-level security).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly log = new Logger('Idempotency');

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const key: string | undefined = req.headers['idempotency-key'];
    const user: AuthUser | undefined = req.user;
    if (!key || !user || req.method === 'GET' || req.method === 'HEAD') return next.handle();
    if (!KEY.test(key)) throw new ConflictException('Idempotency-Key must be 8–100 letters, digits, ":", "_" or "-"');

    const res = ctx.switchToHttp().getResponse();
    const k: Key = { tenantId: user.tenantId, key, userId: user.sub, method: req.method, path: req.originalUrl.split('?')[0] };
    const db = this.prisma.client;
    const inTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ ...tenantContext.getStore(), tenantId: k.tenantId }, fn);
    const where = { tenantId_key: { tenantId: k.tenantId, key: k.key } };

    return from(inTenant(() => this.claim(db, k))).pipe(
      mergeMap((stored) => {
        if (stored) {
          res.status(stored.status);
          res.setHeader('Idempotent-Replay', 'true');
          // When the work was applied, not now (the offline mode compares it with snapshot times).
          res.setHeader('X-Server-Time', stored.at.toISOString());
          return of(stored.response);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await inTenant(async () => {
              await db.idempotentRequest
                .update({ where, data: { status: res.statusCode || 200, response: (body ?? null) as Prisma.InputJsonValue } })
                .catch((e: Error) => this.log.error(`Could not store the reply for ${k.method} ${k.path}: ${e.message}`));
              if (Date.now() - lastPrune > 3_600_000) {
                lastPrune = Date.now();
                await db.idempotentRequest.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
              }
            });
            return body;
          }),
          catchError((err: unknown) =>
            from(
              inTenant(async () => {
                const status = err instanceof HttpException ? err.getStatus() : 500;
                if (status < 500) await db.idempotentRequest.delete({ where }).catch(() => undefined);
                else await db.idempotentRequest.update({ where, data: { status: UNKNOWN } }).catch(() => undefined);
              }),
            ).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  /** Claims the key for this request; returns the stored reply instead when it already ran. */
  private async claim(db: Db, k: Key): Promise<{ status: number; response: unknown; at: Date } | null> {
    try {
      await db.idempotentRequest.create({ data: { ...k, status: RUNNING, response: {} } });
      return null;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
    const seen = await db.idempotentRequest.findUnique({ where: { tenantId_key: { tenantId: k.tenantId, key: k.key } } });
    if (!seen) throw new ConflictException({ message: 'The same request is being processed; try again in a moment', code: 'IDEMPOTENCY_IN_PROGRESS' });
    if (seen.path !== k.path || seen.method !== k.method || seen.userId !== k.userId) {
      throw new ConflictException('This Idempotency-Key was already used for a different request');
    }
    if (seen.status > 0) return { status: seen.status, response: seen.response, at: seen.createdAt };
    if (seen.status === RUNNING && Date.now() - seen.createdAt.getTime() < STALE_MS) {
      throw new ConflictException({ message: 'The same request is being processed; try again in a moment', code: 'IDEMPOTENCY_IN_PROGRESS' });
    }
    throw new ConflictException({
      message: 'An earlier attempt of this did not finish, so it may or may not have been saved. Check in HMIS before sending it again.',
      code: 'IDEMPOTENCY_UNKNOWN',
    });
  }
}

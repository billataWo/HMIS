import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthUser, IS_PUBLIC } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; copy: boolean }>();

/** Call after issuing or revoking a clinic server's sync token. */
export function forgetCloudCopy(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * On the cloud, a clinic that works on its own clinic server has a read-only copy here: staff
 * can look things up and run reports from anywhere, but anything entered here would be
 * overwritten by the clinic server, so it is refused. Runs after AuthGuard.
 */
@Injectable()
export class CloudCopyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  private async isCloudCopy(tenantId: string) {
    const hit = cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.copy;
    const copy = (await this.prisma.system.syncClient.count({ where: { tenantId, revokedAt: null } })) > 0;
    cache.set(tenantId, { at: Date.now(), copy });
    return copy;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (READS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const user: AuthUser | undefined = req.user;
    if (!user || !(await this.isCloudCopy(user.tenantId))) return true;
    throw new ConflictException({
      message: "This is the cloud's read-only copy of the clinic. Records are entered on the clinic's own server.",
      code: 'CLOUD_COPY_READ_ONLY',
    });
  }
}

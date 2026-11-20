import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requestOrigin } from './tenant-context.js';

type Tx = Pick<PrismaService['client'], 'auditLog'>;

/** How long one person's repeated opening of the same record counts as one look. */
const VIEW_WINDOW_MS = 30 * 60_000;
/** The same for a record copied to a PC for offline work. */
const OFFLINE_COPY_WINDOW_MS = 12 * 3_600_000;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an action. Pass `tx` to record the entry inside the same transaction as the change it
   * describes. The request's address and browser are added; the database seals the entry.
   */
  log(
    user: AuthUser,
    action: string,
    entity: string,
    entityId?: string,
    data?: Prisma.InputJsonValue,
    tx: Tx = this.prisma.client,
  ) {
    return tx.auditLog.create({
      data: { tenantId: user.tenantId, userId: user.sub, action, entity, entityId, data, ...requestOrigin() },
    });
  }

  /**
   * Records that someone opened a patient's record (or a visit of it): who looked at a patient is
   * what a privacy complaint asks first. Repeated opening by the same person within half an hour
   * counts once. Never blocks the page: a failure to record is logged, not thrown.
   */
  async viewed(user: AuthUser, entity: 'Patient' | 'Visit', entityId: string, opts: { offline?: boolean } = {}) {
    // The offline workspace copies the day's open visits to the PC every few minutes: that is a
    // copy for offline work, not the person opening each record, and counts once in 12 hours.
    const action = `${entity.toLowerCase()}.${opts.offline ? 'copied_offline' : 'viewed'}`;
    const window = opts.offline ? OFFLINE_COPY_WINDOW_MS : VIEW_WINDOW_MS;
    try {
      const recent = await this.prisma.client.auditLog.findFirst({
        where: { tenantId: user.tenantId, userId: user.sub, entity, entityId, action, createdAt: { gte: new Date(Date.now() - window) } },
        select: { id: true },
      });
      if (!recent) await this.log(user, action, entity, entityId);
    } catch (e) {
      this.logger.error(`Could not record ${entity} view: ${(e as Error).message}`);
    }
  }
}

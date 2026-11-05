import { Injectable } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Pick<PrismaService['client'], 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass `tx` to record the entry inside the same transaction as the change it describes. */
  log(
    user: AuthUser,
    action: string,
    entity: string,
    entityId?: string,
    data?: Prisma.InputJsonValue,
    tx: Tx = this.prisma.client,
  ) {
    return tx.auditLog.create({
      data: { tenantId: user.tenantId, userId: user.sub, action, entity, entityId, data },
    });
  }
}

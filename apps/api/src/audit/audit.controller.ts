import { Controller, Get, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const QuerySchema = z.object({
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
  userId: z.uuid().optional(),
  action: z.string().trim().max(60).optional(), // exact action, or a prefix such as "invoice."
  entity: z.string().trim().max(40).optional(),
  entityId: z.uuid().optional(),
  before: z.iso.datetime().optional(), // paging: entries older than this
});

const PAGE = 100;

/** Who did what and when. Admin only. Entries record which fields changed, never clinical content. */
@Controller('audit')
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() me: AuthUser, @Query(new ZodPipe(QuerySchema)) q: z.infer<typeof QuerySchema>) {
    const from = q.from ?? q.to ?? clinicDay();
    const to = q.to ?? from;
    const where: Prisma.AuditLogWhereInput = {
      tenantId: me.tenantId,
      createdAt: { gte: dayRange(from).start, lt: dayRange(to).end, ...(q.before && { lt: new Date(q.before) }) },
      ...(q.userId && { userId: q.userId }),
      ...(q.action && (q.action.endsWith('.') ? { action: { startsWith: q.action } } : { action: q.action })),
      ...(q.entity && { entity: q.entity }),
      ...(q.entityId && { entityId: q.entityId }),
    };
    const rows = await this.prisma.client.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: PAGE + 1 });
    const page = rows.slice(0, PAGE);
    const userIds = [...new Set(page.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = await this.prisma.client.user.findMany({ where: { id: { in: userIds }, tenantId: me.tenantId }, select: { id: true, fullName: true, role: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const actions = await this.prisma.client.auditLog.findMany({ where: { tenantId: me.tenantId }, distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
    return {
      from,
      to,
      entries: page.map((r) => ({ ...r, user: r.userId ? (byId.get(r.userId) ?? null) : null })),
      next: rows.length > PAGE ? page[page.length - 1].createdAt.toISOString() : null,
      actions: actions.map((a) => a.action),
    };
  }
}

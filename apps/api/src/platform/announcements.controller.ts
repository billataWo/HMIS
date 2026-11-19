import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PlatformAnnouncement, Prisma } from '@hmis/db';
import { AllStaff, type AuthUser, CurrentUser, Public } from '../auth/auth.decorators.js';
import { clientIp } from '../common/client-ip.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentOperator, type Operator, PlatformGuard, PlatformRoles } from './platform-auth.js';

const DAY = 86_400_000;
const uuid = z.uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

const AnnouncementSchema = z
  .object({
    tone: z.enum(['INFO', 'WARNING']).default('INFO'),
    title: z.string().trim().min(3, 'A short title, like "HMIS will be updated on Sunday night"').max(140),
    titleAm: optionalText(140),
    body: optionalText(1000),
    bodyAm: optionalText(1000),
    /** One clinic, or every clinic when left out. */
    tenantId: uuid.nullable().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .refine((a) => !a.endsAt || a.endsAt.getTime() > (a.startsAt ?? new Date()).getTime(), { message: 'The end must be after the start', path: ['endsAt'] });

export type AnnouncementState = 'scheduled' | 'live' | 'ended' | 'withdrawn';
export function announcementState(a: Pick<PlatformAnnouncement, 'startsAt' | 'endsAt' | 'withdrawnAt'>, now = new Date()): AnnouncementState {
  if (a.withdrawnAt) return 'withdrawn';
  if (a.startsAt > now) return 'scheduled';
  if (a.endsAt && a.endsAt <= now) return 'ended';
  return 'live';
}

/** What is showing now, for one clinic: everyone's announcements and its own. */
const live = (tenantId: string, now: Date): Prisma.PlatformAnnouncementWhereInput => ({
  withdrawnAt: null,
  startsAt: { lte: now },
  AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, { OR: [{ tenantId: null }, { tenantId }] }],
});

// Every page of the clinic app asks; a minute is fresh enough (and a change here clears it).
const cache = new Map<string, { at: number; rows: unknown[] }>();
const TTL_MS = 60_000;

/**
 * HMIS's messages to clinics, written in the platform console: planned maintenance, a new feature,
 * a price change. Shown at the top of the clinic app, in the clinic's language when there is an
 * Amharic version. Support and billing operators publish them; every change is in the audit log.
 */
@Controller('platform/announcements')
@Public()
@UseGuards(PlatformGuard)
export class PlatformAnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.system;
  }

  @Get()
  async list() {
    const now = new Date();
    const rows = await this.db.platformAnnouncement.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const [tenants, ops] = await Promise.all([
      this.db.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.db.platformUser.findMany({ where: { id: { in: rows.flatMap((r) => [r.createdById, r.withdrawnById]).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
    ]);
    const clinic = new Map(tenants.map((t) => [t.id, t.name]));
    const name = new Map(ops.map((o) => [o.id, o.fullName]));
    return rows.map((r) => ({
      ...r,
      state: announcementState(r, now),
      clinic: r.tenantId ? (clinic.get(r.tenantId) ?? '') : null,
      createdBy: r.createdById ? (name.get(r.createdById) ?? null) : null,
      withdrawnBy: r.withdrawnById ? (name.get(r.withdrawnById) ?? null) : null,
    }));
  }

  @Post()
  @PlatformRoles('SUPPORT', 'BILLING')
  async publish(@Req() req: Request, @CurrentOperator() op: Operator, @Body(new ZodPipe(AnnouncementSchema)) body: z.infer<typeof AnnouncementSchema>) {
    const now = Date.now();
    const startsAt = body.startsAt ?? new Date(now);
    if (startsAt.getTime() < now - 5 * 60_000) throw new ConflictException('The start has already passed: leave it empty to show it now');
    if (startsAt.getTime() > now + 366 * DAY) throw new ConflictException('Choose a start within a year');
    if (body.tenantId && !(await this.db.tenant.count({ where: { id: body.tenantId } }))) throw new NotFoundException('No such clinic');
    const row = await this.db.platformAnnouncement.create({
      data: { ...body, tenantId: body.tenantId ?? null, startsAt, endsAt: body.endsAt ?? null, createdById: op.sub },
    });
    cache.clear();
    await this.db.platformAuditLog.create({
      data: { operatorId: op.sub, action: 'announcement.published', entity: 'PlatformAnnouncement', entityId: row.id, tenantId: row.tenantId, data: { title: row.title, tone: row.tone, startsAt, endsAt: row.endsAt }, ip: clientIp(req) },
    });
    return row;
  }

  /** Take it down now (it stays in the list, marked withdrawn). */
  @Post(':id/withdraw')
  @HttpCode(200)
  @PlatformRoles('SUPPORT', 'BILLING')
  async withdraw(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const row = await this.db.platformAnnouncement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    const done = await this.db.platformAnnouncement.updateMany({ where: { id, withdrawnAt: null }, data: { withdrawnAt: new Date(), withdrawnById: op.sub } });
    if (!done.count) throw new ConflictException('This announcement was already withdrawn');
    cache.clear();
    await this.db.platformAuditLog.create({
      data: { operatorId: op.sub, action: 'announcement.withdrawn', entity: 'PlatformAnnouncement', entityId: id, tenantId: row.tenantId, data: { title: row.title }, ip: clientIp(req) },
    });
    return { ok: true };
  }
}

/** The clinic app's side: what HMIS is telling this clinic now. */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

  @AllStaff()
  @Get()
  async current(@CurrentUser() me: AuthUser) {
    const hit = cache.get(me.tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
    // Platform rows: read on the owner connection, limited to this clinic by the query itself.
    const rows = await this.prisma.system.platformAnnouncement.findMany({
      where: live(me.tenantId, new Date()),
      orderBy: [{ tone: 'desc' }, { startsAt: 'desc' }],
      take: 3,
      select: { id: true, tone: true, title: true, titleAm: true, body: true, bodyAm: true, startsAt: true, endsAt: true },
    });
    cache.set(me.tenantId, { at: Date.now(), rows });
    return rows;
  }
}

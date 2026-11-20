import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange, isDay } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AUDIT_CATEGORIES, actionsIn, categoryOf, SENSITIVE } from './catalog.js';
import { patientScope, resolveTargets } from './targets.js';

const QuerySchema = z.object({
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
  userId: z.uuid().optional(),
  action: z.string().trim().max(60).optional(), // exact action, or a prefix such as "invoice."
  category: z.enum(AUDIT_CATEGORIES).optional(),
  sensitive: z.enum(['1']).optional(),
  patientId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(), // an MRN, an invoice number, or words in the details
  entity: z.string().trim().max(40).optional(),
  entityId: z.uuid().optional(),
  before: z.iso.datetime().optional(), // paging: entries older than this
});
type Query = z.infer<typeof QuerySchema>;

const PAGE = 100;
/** The most entries one CSV file holds. */
const EXPORT_CAP = 20_000;

/**
 * Who did what, when, and from where. Admin only. Entries record which fields changed and the
 * amounts, never clinical content. Each entry is sealed by the database onto the one before it
 * (migration 20261220000000), so a changed or removed entry shows when the seal is checked.
 */
@Controller('audit')
@Roles('ADMIN')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private period(q: Query) {
    const from = q.from ?? q.to ?? clinicDay();
    const to = q.to ?? from;
    if (!isDay(from) || !isDay(to)) throw new BadRequestException('Choose real dates');
    if (from > to) throw new BadRequestException('"from" must be on or before "to"');
    return { from, to, range: { gte: dayRange(from).start, lt: dayRange(to).end } };
  }

  /** The filters as a query, plus the patient they narrow to (when one is chosen or searched for). */
  private async filter(me: AuthUser, q: Query, range: { gte: Date; lt: Date }) {
    const db = this.prisma.client;
    const t = me.tenantId;
    const and: Prisma.AuditLogWhereInput[] = [];
    if (q.userId) and.push({ userId: q.userId });
    if (q.action) and.push(q.action.endsWith('.') ? { action: { startsWith: q.action } } : { action: q.action });
    if (q.entity) and.push({ entity: q.entity });
    if (q.entityId) and.push({ entityId: q.entityId });
    if (q.category) {
      const recorded = (await db.auditLog.findMany({ where: { tenantId: t }, distinct: ['action'], select: { action: true } })).map((a) => a.action);
      and.push({ action: { in: actionsIn(q.category, recorded) } });
    }
    if (q.sensitive) and.push({ action: { in: [...SENSITIVE] } });

    let patient: { id: string; firstName: string; fatherName: string; mrn: string } | null = null;
    const patientSelect = { id: true, firstName: true, fatherName: true, mrn: true } as const;
    if (q.patientId) patient = await db.patient.findFirst({ where: { tenantId: t, id: q.patientId }, select: patientSelect });
    if (q.q) {
      // An MRN or an invoice number finds that record's entries; anything else, the words.
      const byMrn = await db.patient.findFirst({ where: { tenantId: t, mrn: { equals: q.q, mode: 'insensitive' } }, select: patientSelect });
      const invoice = byMrn ? null : await db.invoice.findFirst({ where: { tenantId: t, number: { equals: q.q, mode: 'insensitive' } }, select: { id: true } });
      if (byMrn) patient = byMrn;
      else if (invoice) and.push({ entityId: invoice.id });
      else {
        const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const hits = await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "AuditLog"
          WHERE "tenantId" = ${t} AND "createdAt" >= ${range.gte} AND "createdAt" < ${range.lt}
            AND ("action" ILIKE ${like} OR "entity" ILIKE ${like} OR "data"::text ILIKE ${like} OR "ip" ILIKE ${like})
          ORDER BY "createdAt" DESC LIMIT ${EXPORT_CAP}`;
        and.push({ id: { in: hits.map((h) => h.id) } });
      }
    }
    if (patient) and.push({ entityId: { in: await patientScope(db, t, patient.id) } });
    return { where: { tenantId: t, createdAt: range, AND: and } satisfies Prisma.AuditLogWhereInput, patient };
  }

  /** The entries with who did them and what they are about, in words and with a link. */
  private async describe(me: AuthUser, rows: { id: string; userId: string | null; action: string; entity: string; entityId: string | null; hash: string | null }[]) {
    const db = this.prisma.client;
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const [users, target] = await Promise.all([
      db.user.findMany({ where: { id: { in: userIds }, tenantId: me.tenantId }, select: { id: true, fullName: true, role: true } }),
      resolveTargets(db, me.tenantId, rows),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map(({ hash, ...r }) => ({
      ...r,
      user: r.userId ? (byId.get(r.userId) ?? null) : null,
      category: categoryOf(r.action),
      sensitive: SENSITIVE.has(r.action),
      target: target(r.entity, r.entityId),
      seal: hash ? hash.slice(0, 12) : null,
    }));
  }

  @Get()
  async list(@CurrentUser() me: AuthUser, @Query(new ZodPipe(QuerySchema)) q: Query) {
    const db = this.prisma.client;
    const { from, to, range } = this.period(q);
    const { where, patient } = await this.filter(me, q, range);
    const paged = q.before ? { ...where, AND: [...where.AND, { createdAt: { lt: new Date(q.before) } }] } : where;

    const [rows, grouped, people, head] = await Promise.all([
      db.auditLog.findMany({ where: paged, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE + 1 }),
      // The period at a glance (whatever else is filtered).
      db.auditLog.groupBy({ by: ['action'], where: { tenantId: me.tenantId, createdAt: range }, _count: { _all: true } }),
      db.auditLog.groupBy({ by: ['userId'], where: { tenantId: me.tenantId, createdAt: range, userId: { not: null } } }),
      db.auditChainHead.findUnique({ where: { tenantId: me.tenantId }, select: { hash: true } }),
    ]);
    const page = rows.slice(0, PAGE);
    const count = (test: (a: string) => boolean) => grouped.filter((g) => test(g.action)).reduce((n, g) => n + g._count._all, 0);
    const byCategory = Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c, count((a) => categoryOf(a) === c)]));
    const matching = await db.auditLog.count({ where });

    return {
      from,
      to,
      patient: patient && { id: patient.id, name: `${patient.firstName} ${patient.fatherName}`, mrn: patient.mrn },
      entries: await this.describe(me, page),
      next: rows.length > PAGE ? page[page.length - 1].createdAt.toISOString() : null,
      matching,
      summary: {
        total: count(() => true),
        byCategory,
        sensitive: count((a) => SENSITIVE.has(a)),
        failedSignIns: count((a) => a === 'auth.login_failed' || a === 'auth.two_step_failed' || a === 'auth.locked'),
        recordViews: count((a) => a.endsWith('.viewed')),
        exports: count((a) => a.endsWith('.exported')),
        people: people.length,
      },
      seal: head?.hash ? head.hash.slice(0, 16) : null,
    };
  }

  /** The filtered entries for a file (every one, up to the cap). Taking the log away is itself logged. */
  @Get('export')
  async export(@CurrentUser() me: AuthUser, @Query(new ZodPipe(QuerySchema)) q: Query) {
    const { from, to, range } = this.period(q);
    if ((range.lt.getTime() - range.gte.getTime()) / 86_400_000 > 367) throw new BadRequestException('Choose a range of at most one year');
    const { where } = await this.filter(me, q, range);
    const rows = await this.prisma.client.auditLog.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: EXPORT_CAP + 1 });
    const entries = await this.describe(me, rows.slice(0, EXPORT_CAP));
    await this.audit.log(me, 'audit.exported', 'AuditLog', undefined, { from, to, rows: entries.length, ...(q.category && { category: q.category }), ...(q.sensitive && { sensitiveOnly: true }) });
    return { from, to, entries, truncated: rows.length > EXPORT_CAP };
  }

  /**
   * Checks the seal over the clinic's whole log: every sealed entry still hashes to its seal (none
   * changed), and every entry's link points at an entry that is still there (none removed).
   */
  @Get('integrity')
  async integrity(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const t = me.tenantId;
    const [[counts], [links], altered, head] = await Promise.all([
      db.$queryRaw<{ sealed: number; unsealed: number; altered: number }[]>`
        SELECT count(*) FILTER (WHERE a."hash" IS NOT NULL)::int AS sealed,
               count(*) FILTER (WHERE a."hash" IS NULL)::int AS unsealed,
               count(*) FILTER (WHERE a."hash" IS NOT NULL AND a."hash" <> hmis_audit_hash(a))::int AS altered
        FROM "AuditLog" a WHERE a."tenantId" = ${t}`,
      db.$queryRaw<{ broken: number }[]>`
        SELECT count(*)::int AS broken FROM "AuditLog" a
        WHERE a."tenantId" = ${t} AND a."prevHash" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "AuditLog" b WHERE b."tenantId" = a."tenantId" AND b."hash" = a."prevHash")`,
      db.$queryRaw<{ id: string; action: string; createdAt: Date }[]>`
        SELECT a."id", a."action", a."createdAt" FROM "AuditLog" a
        WHERE a."tenantId" = ${t} AND a."hash" IS NOT NULL AND a."hash" <> hmis_audit_hash(a)
        ORDER BY a."createdAt" LIMIT 20`,
      db.auditChainHead.findUnique({ where: { tenantId: t }, select: { hash: true, updatedAt: true } }),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      sealed: counts.sealed,
      unsealed: counts.unsealed,
      altered: counts.altered,
      missing: links.broken,
      intact: counts.altered === 0 && links.broken === 0,
      alteredEntries: altered.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      seal: head?.hash ? head.hash.slice(0, 16) : null,
    };
  }
}

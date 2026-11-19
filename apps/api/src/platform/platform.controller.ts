import { hashPassword, temporaryPasswordExpiry } from '../common/passwords.js';
import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma, SubscriptionStatus } from '@hmis/db';
import { Public } from '../auth/auth.decorators.js';
import { clientIp } from '../common/client-ip.js';
import { toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { confirmPayment, issueInvoice, recordPayment } from './billing.js';
import { createClinic, temporaryPassword } from './create-clinic.js';
import { CurrentOperator, forgetOperator, type Operator, PlatformGuard, PlatformRoles } from './platform-auth.js';
import { FEATURES, type SubState, subscriptionState } from './subscription-state.js';
import { forgetSubscription } from './subscription.guard.js';
import { onlineMethods, publicUrl } from './payments/checkout.js';
import { issueLicence, licenceSigningProblem } from '../licence/licence.js';
import { deleteClinicData } from '../exports/clinic-data.js';
import { monthlyCents } from './revenue.js';
import { clinicDay, dayRange, isDay } from '../common/clinic-day.js';

const DAY = 86_400_000;

const uuid = z.uuid();
const money = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), 'An amount like 2500 or 2500.50');
const deployment = z.enum(['CLOUD', 'CLINIC_SERVER', 'ON_PREMISE']);

const ApproveSchema = z.object({
  planCode: z.string().trim().min(1),
  deployment: deployment.optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  clinicName: z.string().trim().min(2).max(120).optional(),
  adminName: z.string().trim().min(2).max(120).optional(),
  adminPhone: z.string().trim().min(9).max(20).optional(),
});
const RejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const SubscriptionSchema = z.object({
  planId: uuid.optional(),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
  deployment: deployment.optional(),
  graceDays: z.number().int().min(0).max(90).optional(),
  trialEndsAt: z.coerce.date().nullable().optional(),
  paidUntil: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const PaymentSchema = z.object({
  amount: money,
  method: z.enum(['CHAPA', 'TELEBIRR', 'BANK_TRANSFER', 'CASH', 'OTHER']),
  reference: z.string().trim().max(100).optional(),
  paidAt: z.coerce.date(),
});
const PlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/, 'Letters, digits and _ only'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  priceMonthly: money,
  priceYearly: money,
  maxStaff: z.number().int().min(1).max(10_000).nullable(),
  features: z.array(z.enum(Object.keys(FEATURES) as [keyof typeof FEATURES])).default([]),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
const OperatorSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(['OWNER', 'BILLING', 'SUPPORT']),
});
const OperatorUpdateSchema = z.object({
  role: z.enum(['OWNER', 'BILLING', 'SUPPORT']).optional(),
  active: z.boolean().optional(),
  resetPassword: z.literal(true).optional(),
  resetTwoStep: z.literal(true).optional(),
});
const SettingsSchema = z.object({
  trialDays: z.number().int().min(0).max(365).optional(),
  graceDays: z.number().int().min(0).max(90).optional(),
  vatPercent: z.number().min(0).max(50).optional(),
  bankDetails: z.string().max(2000).nullable().optional(),
  supportPhone: z.string().max(40).nullable().optional(),
  supportEmail: z.string().max(200).nullable().optional(),
  companyName: z.string().trim().max(200).nullable().optional(),
  companyTin: z.string().trim().max(30).nullable().optional(),
  companyAddress: z.string().trim().max(500).nullable().optional(),
  autoInvoice: z.boolean().optional(),
  invoiceDaysBefore: z.number().int().min(1).max(60).optional(),
  dataRetentionDays: z.number().int().min(30).max(3650).optional(),
});
const NoteSchema = z
  .object({
    kind: z.enum(['NOTE', 'CALL', 'PROMISE']).default('NOTE'),
    body: z.string().trim().min(2, 'Write what was said or agreed').max(2000),
    followUpOn: z.string().refine(isDay, 'A day like 2026-11-19').nullable().optional(),
  })
  .refine((n) => n.kind !== 'PROMISE' || n.followUpOn, { message: 'A promise to pay needs the day they said they would pay', path: ['followUpOn'] });
const DeleteSchema = z.object({ confirmName: z.string().trim().min(1).max(200) });

type Sub = { status: SubscriptionStatus; trialEndsAt: Date | null; paidUntil: Date | null; graceDays: number; suspendedAt: Date | null; cancelledAt: Date | null };
const stateOf = (s: Sub | null) => (s ? subscriptionState(s) : null);

/**
 * The platform console: HMIS's own staff (operators) review requests from clinics, create them,
 * and look after their subscriptions and payments. Only on the HMIS cloud (HMIS_PLATFORM=1).
 * Everything here spans clinics, so it runs on the owner connection; every change is in the
 * platform audit log.
 */
@Controller('platform')
@Public()
@UseGuards(PlatformGuard)
export class PlatformController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.system;
  }

  private audit(req: Request, op: Operator, action: string, entity: string, entityId: string | null, tenantId: string | null, data?: object) {
    return this.db.platformAuditLog.create({ data: { operatorId: op.sub, action, entity, entityId, tenantId, data: data as Prisma.InputJsonValue, ip: clientIp(req) } });
  }

  // ─── Overview ────────────────────────────────────────────────────────────────────────────────
  @Get('overview')
  async overview() {
    const [pendingRequests, pendingPayments, subs, openInvoices, unapplied] = await Promise.all([
      this.db.clinicRequest.count({ where: { status: 'PENDING' } }),
      this.db.platformPayment.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { invoice: { select: { number: true, total: true } } } }),
      this.db.subscription.findMany({ include: { plan: true, tenant: { select: { name: true } } } }),
      this.db.platformInvoice.aggregate({ where: { status: 'OPEN' }, _sum: { total: true }, _count: true }),
      // Paid online, but not applied to an invoice (paid another way meanwhile, or not in birr).
      this.db.platformCheckout.findMany({ where: { status: 'PAID', paymentId: null }, orderBy: { completedAt: 'desc' }, take: 50 }),
    ]);
    const counts: Record<SubState, number> = { trial: 0, active: 0, overdue: 0, suspended: 0, cancelled: 0 };
    let monthly = 0;
    const attention: { tenantId: string; name: string; state: SubState; endsAt: Date | null; daysLeft: number | null }[] = [];
    for (const s of subs) {
      const st = subscriptionState(s);
      counts[st.state] += 1;
      monthly += monthlyCents(s, st.state);
      const soon = st.daysLeft !== null && st.daysLeft <= 7 && (st.state === 'trial' || st.state === 'active');
      if (soon || st.state === 'overdue' || (st.state === 'suspended' && !st.manual)) {
        attention.push({ tenantId: s.tenantId, name: s.tenant.name, state: st.state, endsAt: st.endsAt, daysLeft: st.daysLeft });
      }
    }
    attention.sort((a, b) => (a.endsAt?.getTime() ?? 0) - (b.endsAt?.getTime() ?? 0));
    const tenants = await this.db.tenant.findMany({ where: { id: { in: [...pendingPayments, ...unapplied].map((p) => p.tenantId) } }, select: { id: true, name: true } });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return {
      counts,
      pendingRequests,
      monthlyRecurring: (Math.round(monthly) / 100).toFixed(2),
      openInvoices: { count: openInvoices._count, total: openInvoices._sum.total ?? '0' },
      pendingPayments: pendingPayments.map((p) => ({ ...p, clinic: names.get(p.tenantId) ?? '' })),
      unappliedCheckouts: unapplied.map((c) => ({ ...c, clinic: names.get(c.tenantId) ?? '' })),
      attention,
    };
  }

  // ─── Requests from clinics ───────────────────────────────────────────────────────────────────
  @Get('requests')
  requests(@Query('status') status?: string) {
    const where = status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status) ? { status: status as 'PENDING' } : {};
    return this.db.clinicRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Get('requests/:id')
  async request(@Param('id') id: string) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const r = await this.db.clinicRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    // Clinics with a similar name or the same phone, so a duplicate request is noticed.
    const similar = await this.db.tenant.findMany({
      where: { OR: [{ name: { contains: r.clinicName.split(' ')[0], mode: 'insensitive' } }, { users: { some: { phone: r.contactPhone } } }] },
      select: { id: true, name: true },
      take: 5,
    });
    return { ...r, similar };
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  @PlatformRoles('SUPPORT', 'BILLING')
  async approve(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(ApproveSchema)) body: z.infer<typeof ApproveSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const r = await this.db.clinicRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING') throw new ConflictException(`This request was already ${r.status.toLowerCase()}`);
    const settings = await this.db.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    // Claimed first: if two operators approve at once, only one clinic is created.
    const claimed = await this.db.clinicRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: op.sub, reviewedAt: new Date() } });
    if (!claimed.count) throw new ConflictException('This request was decided by someone else meanwhile');
    let created;
    try {
      created = await createClinic(this.db, {
        name: body.clinicName ?? r.clinicName,
        nameAm: r.clinicNameAm,
        type: r.type,
        phone: r.contactPhone,
        address: [r.address, r.city, r.region].filter(Boolean).join(', '),
        adminName: body.adminName ?? r.contactName,
        adminPhone: body.adminPhone ?? r.contactPhone,
        subscription: { planCode: body.planCode, trialDays: body.trialDays ?? settings.trialDays, graceDays: settings.graceDays, deployment: body.deployment ?? r.deployment },
      });
    } catch (e) {
      await this.db.clinicRequest.update({ where: { id }, data: { status: 'PENDING', reviewedById: null, reviewedAt: null } });
      throw e;
    }
    await this.db.clinicRequest.update({ where: { id }, data: { tenantId: created.tenant.id } });
    await this.db.auditLog.create({ data: { tenantId: created.tenant.id, action: 'clinic.created', entity: 'Tenant', entityId: created.tenant.id, data: { by: 'HMIS platform', request: r.reference } } });
    await this.audit(req, op, 'request.approved', 'ClinicRequest', id, created.tenant.id, { plan: body.planCode, reference: r.reference });
    return { tenantId: created.tenant.id, clinicName: created.tenant.name, adminPhone: created.adminPhone, temporaryPassword: created.password };
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @PlatformRoles('SUPPORT', 'BILLING')
  async reject(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(RejectSchema)) body: z.infer<typeof RejectSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const done = await this.db.clinicRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: op.sub, reviewedAt: new Date(), rejectReason: body.reason },
    });
    if (!done.count) throw new ConflictException('This request is not waiting for a decision');
    await this.audit(req, op, 'request.rejected', 'ClinicRequest', id, null, { reason: body.reason });
    return { ok: true };
  }

  // ─── Clinics and their subscriptions ─────────────────────────────────────────────────────────
  @Get('clinics')
  async clinics(@Query('q') q?: string) {
    const text = (q ?? '').trim().slice(0, 100);
    const like = { contains: text, mode: 'insensitive' as const };
    const tenants = await this.db.tenant.findMany({
      // By name, or by the clinic's or an admin's phone.
      where: text ? { OR: [{ name: like }, { nameAm: like }, { phone: { contains: text } }, { users: { some: { phone: { contains: text } } } }] } : {},
      include: {
        subscription: { include: { plan: { select: { name: true, code: true, maxStaff: true, priceMonthly: true, priceYearly: true } } } },
        _count: { select: { users: { where: { active: true } }, patients: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const ids = tenants.map((t) => t.id);
    const since = new Date(Date.now() - 30 * DAY);
    const [last, visits] = await Promise.all([
      // Last activity: the newest audit entry (sign-ins included).
      this.db.auditLog.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _max: { createdAt: true } }),
      this.db.visit.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, checkedInAt: { gte: since } }, _count: true }),
    ]);
    const lastAt = new Map(last.map((l) => [l.tenantId, l._max.createdAt]));
    const visits30 = new Map(visits.map((v) => [v.tenantId, v._count]));
    return tenants.map((t) => {
      const st = stateOf(t.subscription);
      const { priceMonthly: _m, priceYearly: _y, ...plan } = t.subscription?.plan ?? ({} as { priceMonthly?: unknown; priceYearly?: unknown; name: string; code: string; maxStaff: number | null });
      return {
        id: t.id,
        name: t.name,
        nameAm: t.nameAm,
        type: t.type,
        createdAt: t.createdAt,
        staff: t._count.users,
        patients: t._count.patients,
        visits30: visits30.get(t.id) ?? 0,
        lastActivityAt: lastAt.get(t.id) ?? null,
        mrr: t.subscription && st ? (Math.round(monthlyCents(t.subscription, st.state)) / 100).toFixed(2) : '0.00',
        subscription: t.subscription && { plan, deployment: t.subscription.deployment, billingCycle: t.subscription.billingCycle, ...st! },
      };
    });
  }

  @Get('clinics/:id')
  async clinic(@Param('id') id: string) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const t = await this.db.tenant.findUnique({
      where: { id },
      include: {
        subscription: { include: { plan: true } },
        users: { where: { role: 'ADMIN' }, select: { id: true, fullName: true, phone: true, active: true, totpEnabledAt: true } },
        _count: { select: { users: { where: { active: true } }, patients: true, visits: true } },
      },
    });
    if (!t) throw new NotFoundException();
    const [invoices, payments, request, history, checkouts, lastExport, latestNotes, openNotes] = await Promise.all([
      this.db.platformInvoice.findMany({ where: { tenantId: id }, orderBy: { issuedAt: 'desc' }, take: 50 }),
      this.db.platformPayment.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 50, include: { invoice: { select: { number: true } } } }),
      this.db.clinicRequest.findFirst({ where: { tenantId: id } }),
      this.db.platformAuditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.db.platformCheckout.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      // When the clinic last took its data away (before its records may be deleted).
      this.db.auditLog.findFirst({ where: { tenantId: id, action: 'clinic.exported' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      // The latest 100 notes; every open follow-up is added below, however old.
      this.db.platformNote.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.platformNote.findMany({ where: { tenantId: id, doneAt: null, followUpOn: { not: null } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const settings = await this.db.platformSetting.findUniqueOrThrow({ where: { id: 1 }, select: { dataRetentionDays: true } });
    const { subscription, users, _count, ...tenant } = t;
    const notes = [...new Map([...latestNotes, ...openNotes].map((n) => [n.id, n])).values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const opIds = [...history.map((h) => h.operatorId), ...notes.flatMap((n) => [n.operatorId, n.doneById])].filter((x): x is string => !!x);
    const ops = await this.db.platformUser.findMany({ where: { id: { in: [...new Set(opIds)] } }, select: { id: true, fullName: true } });
    const opNames = new Map(ops.map((o) => [o.id, o.fullName]));
    return {
      tenant,
      admins: users,
      counts: { staff: _count.users, patients: _count.patients, visits: _count.visits },
      usage: await this.usage(id),
      subscription: subscription && { ...subscription, ...stateOf(subscription)! },
      invoices,
      payments,
      request,
      history: history.map((h) => ({ ...h, operator: h.operatorId ? (opNames.get(h.operatorId) ?? null) : null })),
      checkouts,
      notes: notes.map((n) => ({ ...n, operator: n.operatorId ? (opNames.get(n.operatorId) ?? null) : null, doneBy: n.doneById ? (opNames.get(n.doneById) ?? null) : null })),
      lastExportAt: lastExport?.createdAt ?? null,
      deletableFrom: subscription?.cancelledAt && !subscription.dataDeletedAt ? new Date(subscription.cancelledAt.getTime() + settings.dataRetentionDays * 86_400_000) : null,
    };
  }

  /**
   * Is the clinic using HMIS? Visits a day over the last 30 days (against the 30 before), staff who
   * signed in, and its clinic servers. A clinic that stops using it is about to leave.
   */
  private async usage(tenantId: string) {
    const now = Date.now();
    const since = new Date(now - 30 * DAY);
    const before = new Date(now - 60 * DAY);
    const [daily, previous, signIns, users, lastSignIn, servers] = await Promise.all([
      this.db.$queryRaw<{ day: string; n: number }[]>`
        SELECT to_char(("checkedInAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM "Visit" WHERE "tenantId" = ${tenantId} AND "checkedInAt" >= ${since}
        GROUP BY 1`,
      this.db.visit.count({ where: { tenantId, checkedInAt: { gte: before, lt: since } } }),
      this.db.auditLog.count({ where: { tenantId, action: 'auth.login', createdAt: { gte: since } } }),
      this.db.auditLog.groupBy({ by: ['userId'], where: { tenantId, action: 'auth.login', createdAt: { gte: since } } }),
      this.db.auditLog.findFirst({ where: { tenantId, action: 'auth.login' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.db.syncClient.findMany({
        where: { tenantId, revokedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, lastSeenAt: true, lastError: true, edgeVersion: true, createdAt: true },
      }),
    ]);
    const counts = new Map(daily.map((d) => [d.day, d.n]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const day = clinicDay(new Date(now - (29 - i) * DAY));
      return { day, visits: counts.get(day) ?? 0 };
    });
    return {
      days,
      visits30: days.reduce((sum, d) => sum + d.visits, 0),
      visitsPrevious30: previous,
      signIns30: signIns,
      staffSignedIn30: users.filter((u) => u.userId).length,
      lastSignInAt: lastSignIn?.createdAt ?? null,
      servers,
    };
  }

  private async subscriptionOf(tenantId: string) {
    if (!uuid.safeParse(tenantId).success) throw new NotFoundException();
    const sub = await this.db.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('This clinic has no subscription');
    return sub;
  }

  /** Change the plan, billing cycle or dates; or give a clinic without one a subscription. */
  @Patch('clinics/:id/subscription')
  @PlatformRoles('BILLING')
  async updateSubscription(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(SubscriptionSchema)) body: z.infer<typeof SubscriptionSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    if (!(await this.db.tenant.findUnique({ where: { id } }))) throw new NotFoundException();
    if (body.planId && !(await this.db.plan.findUnique({ where: { id: body.planId } }))) throw new NotFoundException('No such plan');
    const existing = await this.db.subscription.findUnique({ where: { tenantId: id } });
    let sub;
    if (existing) {
      sub = await this.db.subscription.update({ where: { tenantId: id }, data: body });
    } else {
      if (!body.planId) throw new ConflictException('Choose a plan');
      const { planId, ...rest } = body;
      sub = await this.db.subscription.create({ data: { ...rest, tenantId: id, planId, status: 'ACTIVE' } });
    }
    forgetSubscription(id);
    await this.audit(req, op, existing ? 'subscription.updated' : 'subscription.created', 'Subscription', sub.id, id, body);
    return { ...sub, ...subscriptionState(sub) };
  }

  @Post('clinics/:id/suspend')
  @HttpCode(200)
  @PlatformRoles('BILLING')
  async suspend(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>) {
    const sub = await this.subscriptionOf(id);
    await this.db.subscription.update({ where: { id: sub.id }, data: { suspendedAt: new Date(), suspendReason: body.reason } });
    forgetSubscription(id);
    await this.audit(req, op, 'subscription.suspended', 'Subscription', sub.id, id, body);
    return { ok: true };
  }

  @Post('clinics/:id/reactivate')
  @HttpCode(200)
  @PlatformRoles('BILLING')
  async reactivate(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string) {
    const sub = await this.subscriptionOf(id);
    await this.db.subscription.update({
      where: { id: sub.id },
      data: { suspendedAt: null, suspendReason: null, cancelledAt: null, cancelReason: null, ...(sub.status === 'CANCELLED' && { status: 'ACTIVE' }) },
    });
    forgetSubscription(id);
    await this.audit(req, op, 'subscription.reactivated', 'Subscription', sub.id, id);
    return { ok: true };
  }

  /** The clinic stops being billed and becomes read-only; its data stays until it is exported and deleted. */
  @Post('clinics/:id/cancel')
  @HttpCode(200)
  @PlatformRoles('BILLING')
  async cancel(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>) {
    const sub = await this.subscriptionOf(id);
    await this.db.$transaction([
      this.db.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: body.reason } }),
      this.db.platformInvoice.updateMany({ where: { subscriptionId: sub.id, status: 'OPEN' }, data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Subscription cancelled' } }),
    ]);
    forgetSubscription(id);
    await this.audit(req, op, 'subscription.cancelled', 'Subscription', sub.id, id, body);
    return { ok: true };
  }

  /** The licence file for a clinic that runs on its own server (synced ones fetch theirs). */
  @Get('clinics/:id/licence')
  @PlatformRoles('BILLING')
  async licence(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string) {
    await this.subscriptionOf(id);
    const { licence, text } = await issueLicence(this.db, id);
    await this.audit(req, op, 'licence.issued', 'Licence', licence.id, id, { endsAt: licence.endsAt, plan: licence.plan.code });
    const name = licence.clinicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { filename: `hmis-licence-${name || 'clinic'}-${licence.issuedAt.slice(0, 10)}.txt`, licence: text, endsAt: licence.endsAt };
  }

  /**
   * Deletes a cancelled clinic's records, once the time it had to export them has passed. Owners
   * only, confirmed by typing the clinic's name. The clinic row, its subscription and HMIS's
   * invoices stay; its clinic servers are disconnected first so nothing is sent back.
   */
  @Post('clinics/:id/delete-data')
  @HttpCode(200)
  @PlatformRoles('OWNER')
  async deleteData(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(DeleteSchema)) body: z.infer<typeof DeleteSchema>) {
    const sub = await this.subscriptionOf(id);
    const tenant = await this.db.tenant.findUniqueOrThrow({ where: { id } });
    if (!sub.cancelledAt) throw new ConflictException('Cancel the subscription first: only a clinic that has left can have its records deleted.');
    if (sub.dataDeletedAt) throw new ConflictException("This clinic's records are already deleted.");
    const settings = await this.db.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    const from = new Date(sub.cancelledAt.getTime() + settings.dataRetentionDays * 86_400_000);
    if (from > new Date()) throw new ConflictException(`The clinic has until ${from.toISOString().slice(0, 10)} to export its records (${settings.dataRetentionDays} days after cancelling).`);
    if (body.confirmName.toLowerCase() !== tenant.name.trim().toLowerCase()) throw new ConflictException("Type the clinic's name exactly to confirm.");
    if (!process.env.APP_DATABASE_URL) throw new ConflictException('Deleting needs the restricted database role (APP_DATABASE_URL).');

    const revoked = await this.db.syncClient.updateMany({ where: { tenantId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    const counts = await deleteClinicData(this.db, this.prisma.client, id);
    await this.db.subscription.update({ where: { id: sub.id }, data: { dataDeletedAt: new Date() } });
    forgetSubscription(id);
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    await this.audit(req, op, 'clinic.data_deleted', 'Tenant', id, id, { clinic: tenant.name, rows, counts, clinicServersDisconnected: revoked.count });
    return { ok: true, rows, counts };
  }

  // ─── Invoices and payments ───────────────────────────────────────────────────────────────────
  @Post('clinics/:id/invoices')
  @PlatformRoles('BILLING')
  async invoice(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string) {
    await this.subscriptionOf(id);
    const invoice = await issueInvoice(this.db, id, op.sub);
    await this.audit(req, op, 'invoice.issued', 'PlatformInvoice', invoice.id, id, { number: invoice.number, total: invoice.total.toString() });
    return invoice;
  }

  // ─── Follow-up: calls, promises to pay, notes for the next operator ─────────────────────────────
  @Post('clinics/:id/notes')
  @PlatformRoles('SUPPORT', 'BILLING')
  async addNote(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(NoteSchema)) body: z.infer<typeof NoteSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    if (!(await this.db.tenant.count({ where: { id } }))) throw new NotFoundException();
    let followUpOn: Date | null = null;
    if (body.followUpOn) {
      const today = clinicDay();
      const latest = clinicDay(new Date(Date.now() + 366 * DAY));
      if (body.followUpOn < today) throw new ConflictException('The follow-up day has already passed');
      if (body.followUpOn > latest) throw new ConflictException('Choose a follow-up day within a year');
      followUpOn = dayRange(body.followUpOn).start;
    }
    const note = await this.db.platformNote.create({ data: { tenantId: id, kind: body.kind, body: body.body, followUpOn, operatorId: op.sub } });
    await this.audit(req, op, 'note.added', 'PlatformNote', note.id, id, { kind: body.kind, followUpOn: body.followUpOn ?? null });
    return note;
  }

  /** The follow-up is done: the call was made, the promised payment came (or did not). */
  @Post('notes/:id/done')
  @HttpCode(200)
  @PlatformRoles('SUPPORT', 'BILLING')
  async noteDone(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const note = await this.db.platformNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException();
    const done = await this.db.platformNote.updateMany({ where: { id, doneAt: null, followUpOn: { not: null } }, data: { doneAt: new Date(), doneById: op.sub } });
    if (!done.count) throw new ConflictException(note.doneAt ? 'This follow-up is already done' : 'This note has no follow-up');
    await this.audit(req, op, 'note.done', 'PlatformNote', id, note.tenantId, { kind: note.kind });
    return { ok: true };
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @PlatformRoles('BILLING')
  async voidInvoice(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const invoice = await this.db.platformInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException();
    const done = await this.db.platformInvoice.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'VOID', voidedAt: new Date(), voidReason: body.reason } });
    if (!done.count) throw new ConflictException(`Invoice ${invoice.number} is ${invoice.status.toLowerCase()}: only an open invoice can be voided`);
    await this.db.platformPayment.updateMany({ where: { invoiceId: id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedById: op.sub, reviewedAt: new Date(), rejectReason: 'Invoice voided' } });
    await this.audit(req, op, 'invoice.voided', 'PlatformInvoice', id, invoice.tenantId, { number: invoice.number, reason: body.reason });
    return { ok: true };
  }

  /** Money HMIS has received for an invoice (bank transfer seen on the statement, cash...). */
  @Post('invoices/:id/payments')
  @PlatformRoles('BILLING')
  async pay(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(PaymentSchema)) body: z.infer<typeof PaymentSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    if (toCents(body.amount) <= 0) throw new ConflictException('Enter the amount received');
    const result = await recordPayment(this.db, { invoiceId: id, ...body, operatorId: op.sub });
    await this.audit(req, op, 'payment.recorded', 'PlatformPayment', result.payment.id, result.invoice.tenantId, {
      invoice: result.invoice.number,
      amount: body.amount,
      method: body.method,
      reference: body.reference,
      paidInFull: result.paidInFull,
    });
    return result;
  }

  @Post('payments/:id/confirm')
  @HttpCode(200)
  @PlatformRoles('BILLING')
  async confirm(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const result = await confirmPayment(this.db, id, op.sub);
    await this.audit(req, op, 'payment.confirmed', 'PlatformPayment', id, result.invoice.tenantId, { invoice: result.invoice.number, paidInFull: result.paidInFull });
    return result;
  }

  @Post('payments/:id/reject')
  @HttpCode(200)
  @PlatformRoles('BILLING')
  async rejectPayment(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const payment = await this.db.platformPayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException();
    const done = await this.db.platformPayment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: op.sub, reviewedAt: new Date(), rejectReason: body.reason },
    });
    if (!done.count) throw new ConflictException(`This payment is already ${payment.status.toLowerCase()}`);
    await this.audit(req, op, 'payment.rejected', 'PlatformPayment', id, payment.tenantId, body);
    return { ok: true };
  }

  // ─── Plans ───────────────────────────────────────────────────────────────────────────────────
  @Get('plans')
  async plans() {
    const plans = await this.db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { subscriptions: true } } } });
    return { plans, features: FEATURES };
  }

  @Post('plans')
  @PlatformRoles('OWNER')
  async createPlan(@Req() req: Request, @CurrentOperator() op: Operator, @Body(new ZodPipe(PlanSchema)) body: z.infer<typeof PlanSchema>) {
    if (await this.db.plan.findUnique({ where: { code: body.code } })) throw new ConflictException(`A plan with code ${body.code} exists`);
    const plan = await this.db.plan.create({ data: body });
    await this.audit(req, op, 'plan.created', 'Plan', plan.id, null, body);
    return plan;
  }

  /** New prices apply to the next invoices; limits and modules apply to every clinic on the plan at once. */
  @Patch('plans/:id')
  @PlatformRoles('OWNER')
  async updatePlan(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(PlanSchema.partial())) body: Partial<z.infer<typeof PlanSchema>>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const plan = await this.db.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException();
    if (body.code && body.code !== plan.code && (await this.db.plan.findUnique({ where: { code: body.code } }))) throw new ConflictException(`A plan with code ${body.code} exists`);
    const updated = await this.db.plan.update({ where: { id }, data: body });
    forgetSubscription();
    await this.audit(req, op, 'plan.updated', 'Plan', id, null, body);
    return updated;
  }

  // ─── Operators ───────────────────────────────────────────────────────────────────────────────
  @Get('operators')
  @PlatformRoles('OWNER')
  operators() {
    return this.db.platformUser.findMany({
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true, role: true, active: true, totpEnabledAt: true, lastSignInAt: true, createdAt: true },
    });
  }

  @Post('operators')
  @PlatformRoles('OWNER')
  async addOperator(@Req() req: Request, @CurrentOperator() op: Operator, @Body(new ZodPipe(OperatorSchema)) body: z.infer<typeof OperatorSchema>) {
    if (await this.db.platformUser.findUnique({ where: { email: body.email } })) throw new ConflictException('An operator with this email exists');
    const password = temporaryPassword();
    const created = await this.db.platformUser.create({ data: { ...body, passwordHash: await hashPassword(password), temporaryPasswordExpiresAt: temporaryPasswordExpiry() } });
    await this.audit(req, op, 'operator.created', 'PlatformUser', created.id, null, body);
    return { id: created.id, email: created.email, temporaryPassword: password };
  }

  @Patch('operators/:id')
  @PlatformRoles('OWNER')
  async updateOperator(@Req() req: Request, @CurrentOperator() op: Operator, @Param('id') id: string, @Body(new ZodPipe(OperatorUpdateSchema)) body: z.infer<typeof OperatorUpdateSchema>) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    if (id === op.sub && (body.active === false || (body.role && body.role !== 'OWNER'))) throw new ConflictException('You cannot deactivate yourself or remove your own owner role');
    const target = await this.db.platformUser.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    const password = body.resetPassword ? temporaryPassword() : null;
    await this.db.platformUser.update({
      where: { id },
      data: {
        ...(body.role && { role: body.role }),
        ...(body.active !== undefined && { active: body.active }),
        ...(password && { passwordHash: await hashPassword(password), mustChangePassword: true, temporaryPasswordExpiresAt: temporaryPasswordExpiry() }),
        ...(body.resetTwoStep && { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryCodes: [] }),
        ...((password || body.resetTwoStep || body.active === false) && { sessionsValidAfter: new Date() }),
      },
    });
    forgetOperator(id);
    await this.audit(req, op, 'operator.updated', 'PlatformUser', id, null, { ...body, resetPassword: !!password });
    return { ok: true, ...(password && { temporaryPassword: password }) };
  }

  // ─── Settings and history ────────────────────────────────────────────────────────────────────
  @Get('settings')
  async settings() {
    const settings = await this.db.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
    // Online payments are set on the server (deploy/.env), never here: the keys stay out of the database.
    return { ...settings, online: onlineMethods(), publicUrl: publicUrl(), licences: !licenceSigningProblem(), licenceProblem: licenceSigningProblem() };
  }

  @Patch('settings')
  @PlatformRoles('OWNER')
  async updateSettings(@Req() req: Request, @CurrentOperator() op: Operator, @Body(new ZodPipe(SettingsSchema)) body: z.infer<typeof SettingsSchema>) {
    const updated = await this.db.platformSetting.update({ where: { id: 1 }, data: body });
    await this.audit(req, op, 'settings.updated', 'PlatformSetting', '1', null, body);
    return updated;
  }

  /**
   * The console's history, newest first: 200 at a time, older ones with `before` (the id of the
   * oldest entry shown, so entries with the same time are not skipped). Filtered by clinic, operator or kind (`area`: the part before the dot, e.g.
   * "payment", "platform" for sign-ins).
   */
  @Get('audit')
  async history(@Query('tenantId') tenantId?: string, @Query('operatorId') operatorId?: string, @Query('area') area?: string, @Query('before') before?: string) {
    const where: Prisma.PlatformAuditLogWhereInput = {};
    if (tenantId && uuid.safeParse(tenantId).success) where.tenantId = tenantId;
    if (operatorId && uuid.safeParse(operatorId).success) where.operatorId = operatorId;
    if (area && /^[a-z_]{2,30}$/.test(area)) where.action = { startsWith: `${area}.` };
    const cursor = before && uuid.safeParse(before).success ? await this.db.platformAuditLog.findUnique({ where: { id: before }, select: { id: true, createdAt: true } }) : null;
    if (cursor) where.AND = [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }];
    const entries = await this.db.platformAuditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
    const [ops, tenants] = await Promise.all([
      this.db.platformUser.findMany({ where: { id: { in: entries.map((e) => e.operatorId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
      this.db.tenant.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.tenantId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
    ]);
    const names = new Map(ops.map((o) => [o.id, o.fullName]));
    const clinics = new Map(tenants.map((t) => [t.id, t.name]));
    return entries.map((e) => ({ ...e, operator: e.operatorId ? (names.get(e.operatorId) ?? null) : null, clinic: e.tenantId ? (clinics.get(e.tenantId) ?? null) : null }));
  }
}


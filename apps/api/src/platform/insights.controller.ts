import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { PlatformPaymentMethod, PlatformPaymentStatus, Prisma } from '@hmis/db';
import { Public } from '../auth/auth.decorators.js';
import { clinicDay, dayRange, isDay } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentOperator, type Operator, PlatformGuard } from './platform-auth.js';
import { type AgeBucket, ageBucket, daysLate, lastMonths, lateBefore, monthlyCents, monthOf, monthStart } from './revenue.js';
import { type SubState, subscriptionState } from './subscription-state.js';

const DAY = 86_400_000;
const uuid = z.uuid();
const METHODS = ['CHAPA', 'TELEBIRR', 'BANK_TRANSFER', 'CASH', 'OTHER'] as const;
const money = (cents: number) => fromCents(Math.round(cents));
/** Left as typed, apart from the spaces around it; never a pattern (Prisma escapes it). */
const term = (q?: string) => (q ?? '').trim().slice(0, 100);

/**
 * The console's numbers and ledgers: the business at a glance (recurring revenue, money collected,
 * what is owed and how late), every invoice and payment across clinics, one invoice to print, and
 * the search box. Read-only: every change stays in the PlatformController, with its audit entry.
 */
@Controller('platform')
@Public()
@UseGuards(PlatformGuard)
export class PlatformInsightsController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.system;
  }

  private async clinicNames(ids: string[]) {
    const tenants = await this.db.tenant.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(tenants.map((t) => [t.id, t.name]));
  }

  /** For the menu's badges: requests to decide, reported payments to confirm, follow-ups due. */
  @Get('counts')
  async counts() {
    const [pendingRequests, pendingPayments, followUpsDue, serversOffline] = await Promise.all([
      this.db.clinicRequest.count({ where: { status: 'PENDING' } }),
      this.db.platformPayment.count({ where: { status: 'PENDING' } }),
      this.db.platformNote.count({ where: { doneAt: null, followUpOn: { lt: dayRange(clinicDay()).end } } }),
      // Clinic servers not heard from for a day, or set up a day ago and never connected (as on the Health page).
      this.db.syncClient.count({
        where: { revokedAt: null, OR: [{ lastSeenAt: { lt: new Date(Date.now() - DAY) } }, { lastSeenAt: null, createdAt: { lt: new Date(Date.now() - DAY) } }] },
      }),
    ]);
    return { pendingRequests, pendingPayments, followUpsDue, serversOffline };
  }

  /**
   * Follow-ups: calls to make and promises to pay to check, from the notes on each clinic. "due" is
   * today and anything missed; "upcoming" is later; "done" the last ones finished.
   */
  @Get('follow-ups')
  async followUps(@CurrentOperator() op: Operator, @Query('scope') scope?: string, @Query('mine') mine?: string) {
    const endOfToday = dayRange(clinicDay()).end;
    const show = scope === 'upcoming' || scope === 'done' ? scope : 'due';
    const own = mine === '1' ? { operatorId: op.sub } : {};
    const open = { doneAt: null, followUpOn: { not: null } };
    const where: Prisma.PlatformNoteWhereInput =
      show === 'done'
        ? { ...own, doneAt: { not: null } }
        : { ...own, doneAt: null, followUpOn: show === 'due' ? { lt: endOfToday } : { gte: endOfToday } };
    const [notes, due, upcoming, dueMine] = await Promise.all([
      this.db.platformNote.findMany({ where, orderBy: show === 'done' ? { doneAt: 'desc' } : { followUpOn: 'asc' }, take: 300 }),
      this.db.platformNote.count({ where: { ...open, followUpOn: { lt: endOfToday } } }),
      this.db.platformNote.count({ where: { ...open, followUpOn: { gte: endOfToday } } }),
      this.db.platformNote.count({ where: { ...open, operatorId: op.sub, followUpOn: { lt: endOfToday } } }),
    ]);
    const tenantIds = [...new Set(notes.map((n) => n.tenantId))];
    const [tenants, owed, ops] = await Promise.all([
      // The clinic's phone, or else its first active admin's: someone to call.
      this.db.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true, phone: true, users: { where: { role: 'ADMIN', active: true }, orderBy: { createdAt: 'asc' }, take: 1, select: { phone: true } } },
      }),
      this.db.platformInvoice.findMany({
        where: { tenantId: { in: tenantIds }, status: 'OPEN' },
        select: { tenantId: true, total: true, dueDate: true, payments: { where: { status: 'CONFIRMED' }, select: { amount: true } } },
      }),
      this.db.platformUser.findMany({ where: { id: { in: [...new Set(notes.flatMap((n) => [n.operatorId, n.doneById]).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } }),
    ]);
    const clinics = new Map(tenants.map(({ users, ...t }) => [t.id, { ...t, phone: t.phone ?? users[0]?.phone ?? null }]));
    const names = new Map(ops.map((o) => [o.id, o.fullName]));
    // What each clinic owes now, so the caller knows the amount before dialling.
    const balance = new Map<string, number>();
    for (const i of owed) balance.set(i.tenantId, (balance.get(i.tenantId) ?? 0) + Math.max(0, toCents(i.total) - i.payments.reduce((sum, p) => sum + toCents(p.amount), 0)));
    const now = new Date();
    return {
      summary: { due, upcoming, dueMine },
      notes: notes.map((n) => ({
        ...n,
        clinic: clinics.get(n.tenantId) ?? { id: n.tenantId, name: '', phone: null },
        owes: money(balance.get(n.tenantId) ?? 0),
        daysLate: n.followUpOn && !n.doneAt ? daysLate(n.followUpOn, now) : 0,
        operator: n.operatorId ? (names.get(n.operatorId) ?? null) : null,
        doneBy: n.doneById ? (names.get(n.doneById) ?? null) : null,
      })),
    };
  }

  // ─── The business at a glance ────────────────────────────────────────────────────────────────
  @Get('metrics')
  async metrics() {
    const now = new Date();
    const months = lastMonths(12, now);
    const since = monthStart(months[0]);
    const [subs, payments, open] = await Promise.all([
      this.db.subscription.findMany({ include: { plan: { select: { id: true, name: true, code: true, priceMonthly: true, priceYearly: true } } } }),
      this.db.platformPayment.findMany({ where: { status: 'CONFIRMED', paidAt: { gte: since } }, select: { amount: true, paidAt: true, method: true } }),
      this.db.platformInvoice.findMany({
        where: { status: 'OPEN' },
        select: { total: true, dueDate: true, payments: { where: { status: 'CONFIRMED' }, select: { amount: true } } },
      }),
    ]);

    // Month by month: money in, clinics joining and leaving.
    const series = new Map(months.map((m) => [m, { month: m, collected: 0, newClinics: 0, cancelled: 0 }]));
    for (const p of payments) {
      const row = series.get(monthOf(p.paidAt));
      if (row) row.collected += toCents(p.amount);
    }
    const byMethod = new Map<PlatformPaymentMethod, number>();
    for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + toCents(p.amount));

    const counts: Record<SubState, number> = { trial: 0, active: 0, overdue: 0, suspended: 0, cancelled: 0 };
    const byPlan = new Map<string, { plan: string; code: string; clinics: number; paying: number; mrr: number }>();
    let mrr = 0;
    let paying = 0;
    let trialsEndingSoon = 0;
    const conversion = { ended: 0, converted: 0 };
    const churn = { cancelled: 0, lostMrr: 0 };
    for (const s of subs) {
      const st = subscriptionState(s, now);
      counts[st.state] += 1;
      const cents = monthlyCents(s, st.state);
      mrr += cents;
      if (cents) paying += 1;
      const plan = byPlan.get(s.planId) ?? { plan: s.plan.name, code: s.plan.code, clinics: 0, paying: 0, mrr: 0 };
      if (st.state !== 'cancelled') plan.clinics += 1;
      if (cents) plan.paying += 1;
      plan.mrr += cents;
      byPlan.set(s.planId, plan);

      if (st.state === 'trial' && st.daysLeft !== null && st.daysLeft <= 30) trialsEndingSoon += 1;
      // Trials that ended in the last 90 days, and how many became paying clinics.
      if (s.trialEndsAt && s.trialEndsAt <= now && s.trialEndsAt.getTime() > now.getTime() - 90 * DAY) {
        conversion.ended += 1;
        if (s.status === 'ACTIVE' && !s.cancelledAt) conversion.converted += 1;
      }
      if (s.cancelledAt && s.cancelledAt.getTime() > now.getTime() - 90 * DAY) {
        churn.cancelled += 1;
        // Revenue lost only from clinics that were paying (a paid period), not trials that lapsed.
        if (s.paidUntil) churn.lostMrr += s.billingCycle === 'YEARLY' ? toCents(s.plan.priceYearly) / 12 : toCents(s.plan.priceMonthly);
      }
      const joined = series.get(monthOf(s.createdAt));
      if (joined) joined.newClinics += 1;
      const left = s.cancelledAt && series.get(monthOf(s.cancelledAt));
      if (left) left.cancelled += 1;
    }

    // What clinics owe, by how late it is.
    const ageing: Record<AgeBucket, { count: number; amount: number }> = {
      current: { count: 0, amount: 0 },
      d1_30: { count: 0, amount: 0 },
      d31_60: { count: 0, amount: 0 },
      d61_90: { count: 0, amount: 0 },
      d90_plus: { count: 0, amount: 0 },
    };
    let owed = 0;
    for (const i of open) {
      const balance = toCents(i.total) - i.payments.reduce((sum, p) => sum + toCents(p.amount), 0);
      if (balance <= 0) continue;
      const b = ageing[ageBucket(i.dueDate, now)];
      b.count += 1;
      b.amount += balance;
      owed += balance;
    }

    const rows = [...series.values()];
    const thisMonth = rows[rows.length - 1];
    const lastMonth = rows[rows.length - 2];
    return {
      asOf: now,
      counts,
      mrr: money(mrr),
      arr: money(mrr * 12),
      paying,
      arpa: money(paying ? mrr / paying : 0),
      collectedThisMonth: money(thisMonth.collected),
      collectedLastMonth: money(lastMonth.collected),
      collected12Months: money(rows.reduce((sum, r) => sum + r.collected, 0)),
      months: rows.map((r) => ({ ...r, collected: money(r.collected) })),
      byPlan: [...byPlan.values()].sort((a, b) => b.mrr - a.mrr || b.clinics - a.clinics).map((p) => ({ ...p, mrr: money(p.mrr) })),
      byMethod: METHODS.filter((m) => byMethod.has(m)).map((m) => ({ method: m, amount: money(byMethod.get(m)!) })),
      receivables: {
        total: money(owed),
        ageing: Object.fromEntries(Object.entries(ageing).map(([k, v]) => [k, { count: v.count, amount: money(v.amount) }])) as Record<AgeBucket, { count: number; amount: string }>,
      },
      trialsEndingSoon,
      conversion: { ...conversion, rate: conversion.ended ? conversion.converted / conversion.ended : null },
      churn: { cancelled: churn.cancelled, lostMrr: money(churn.lostMrr) },
    };
  }

  // ─── Every invoice ───────────────────────────────────────────────────────────────────────────
  @Get('invoices')
  async invoices(@Query('status') status?: string, @Query('q') q?: string) {
    const now = new Date();
    const text = term(q);
    // The search narrows everything, the counts on the status filters included; the status only the list.
    const searched: Prisma.PlatformInvoiceWhereInput = {};
    if (text) {
      const tenants = await this.db.tenant.findMany({ where: { name: { contains: text, mode: 'insensitive' } }, select: { id: true }, take: 200 });
      searched.OR = [{ number: { contains: text, mode: 'insensitive' } }, { tenantId: { in: tenants.map((t) => t.id) } }];
    }
    const overdueWhere: Prisma.PlatformInvoiceWhereInput = { ...searched, status: 'OPEN', dueDate: { lt: lateBefore(now) } };
    const where: Prisma.PlatformInvoiceWhereInput =
      status === 'OPEN' || status === 'PAID' || status === 'VOID' ? { ...searched, status } : status === 'OVERDUE' ? overdueWhere : searched;
    const [invoices, groups, overdue] = await Promise.all([
      this.db.platformInvoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        take: 500,
        include: { payments: { where: { status: 'CONFIRMED' }, select: { amount: true } } },
      }),
      this.db.platformInvoice.groupBy({ by: ['status'], where: searched, _count: true, _sum: { total: true } }),
      this.db.platformInvoice.count({ where: overdueWhere }),
    ]);
    const open = invoices.filter((i) => i.status === 'OPEN').map((i) => i.tenantId);
    const [names, promises] = await Promise.all([
      this.clinicNames(invoices.map((i) => i.tenantId)),
      open.length
        ? this.db.platformNote.findMany({ where: { tenantId: { in: [...new Set(open)] }, kind: 'PROMISE', doneAt: null }, orderBy: { followUpOn: 'asc' }, select: { tenantId: true, followUpOn: true } })
        : [],
    ]);
    // The clinic's earliest open promise to pay; "broken" once its day has passed.
    const promise = new Map<string, Date>();
    for (const p of promises) if (p.followUpOn && !promise.has(p.tenantId)) promise.set(p.tenantId, p.followUpOn);
    const summary = Object.fromEntries(groups.map((g) => [g.status, { count: g._count, total: g._sum.total?.toString() ?? '0' }]));
    return {
      summary: { ...summary, OVERDUE: { count: overdue } },
      invoices: invoices.map(({ payments, ...i }) => {
        const paid = payments.reduce((sum, p) => sum + toCents(p.amount), 0);
        const balance = i.status === 'OPEN' ? Math.max(0, toCents(i.total) - paid) : 0;
        const promised = i.status === 'OPEN' ? promise.get(i.tenantId) : undefined;
        return {
          ...i,
          clinic: names.get(i.tenantId) ?? '',
          paid: money(paid),
          balance: money(balance),
          daysLate: i.status === 'OPEN' ? daysLate(i.dueDate, now) : 0,
          promise: promised ? { on: promised, broken: daysLate(promised, now) > 0 } : null,
        };
      }),
    };
  }

  /** One invoice, with what is needed to print it: the clinic, HMIS's details, the payments. */
  @Get('invoices/:id')
  async invoice(@Param('id') id: string) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const invoice = await this.db.platformInvoice.findUnique({
      where: { id },
      include: { payments: { orderBy: { paidAt: 'asc' } }, subscription: { select: { deployment: true } } },
    });
    if (!invoice) throw new NotFoundException();
    const [tenant, settings] = await Promise.all([
      this.db.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId }, select: { id: true, name: true, nameAm: true, address: true, phone: true, tin: true } }),
      this.db.platformSetting.findUniqueOrThrow({ where: { id: 1 }, select: { vatPercent: true, bankDetails: true, supportPhone: true, supportEmail: true, companyName: true, companyTin: true, companyAddress: true } }),
    ]);
    const paid = invoice.payments.filter((p) => p.status === 'CONFIRMED').reduce((sum, p) => sum + toCents(p.amount), 0);
    const { subscription, ...rest } = invoice;
    return {
      invoice: { ...rest, deployment: subscription.deployment, paid: money(paid), balance: money(invoice.status === 'OPEN' ? Math.max(0, toCents(invoice.total) - paid) : 0) },
      clinic: tenant,
      issuer: { ...settings, publicUrl: process.env.HMIS_PUBLIC_URL?.replace(/\/+$/, '') || null },
    };
  }

  // ─── Every payment ───────────────────────────────────────────────────────────────────────────
  @Get('payments')
  async payments(@Query('status') status?: string, @Query('method') method?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('q') q?: string) {
    const where: Prisma.PlatformPaymentWhereInput = {};
    if (status === 'PENDING' || status === 'CONFIRMED' || status === 'REJECTED') where.status = status as PlatformPaymentStatus;
    if (method && (METHODS as readonly string[]).includes(method)) where.method = method as PlatformPaymentMethod;
    const paidAt: Prisma.DateTimeFilter = {};
    if (isDay(from)) paidAt.gte = dayRange(from).start;
    if (isDay(to)) paidAt.lt = dayRange(to).end;
    if (paidAt.gte || paidAt.lt) where.paidAt = paidAt;
    const text = term(q);
    if (text) {
      const tenants = await this.db.tenant.findMany({ where: { name: { contains: text, mode: 'insensitive' } }, select: { id: true }, take: 200 });
      where.OR = [
        { reference: { contains: text, mode: 'insensitive' } },
        { invoice: { number: { contains: text, mode: 'insensitive' } } },
        { tenantId: { in: tenants.map((t) => t.id) } },
      ];
    }
    const payments = await this.db.platformPayment.findMany({ where, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], take: 1000, include: { invoice: { select: { number: true } } } });
    const [names, operators] = await Promise.all([
      this.clinicNames(payments.map((p) => p.tenantId)),
      this.db.platformUser.findMany({ where: { id: { in: payments.map((p) => p.reviewedById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
    ]);
    const who = new Map(operators.map((o) => [o.id, o.fullName]));
    const confirmed = payments.filter((p) => p.status === 'CONFIRMED');
    return {
      summary: {
        count: payments.length,
        confirmed: money(confirmed.reduce((sum, p) => sum + toCents(p.amount), 0)),
        pending: payments.filter((p) => p.status === 'PENDING').length,
      },
      payments: payments.map(({ provider: _provider, ...p }) => ({ ...p, clinic: names.get(p.tenantId) ?? '', reviewedBy: p.reviewedById ? (who.get(p.reviewedById) ?? null) : null })),
    };
  }

  // ─── The search box ──────────────────────────────────────────────────────────────────────────
  /** Clinics (by name, phone or an admin's phone), invoices, requests and payments, a few of each. */
  @Get('search')
  async search(@Query('q') q?: string) {
    const text = term(q);
    if (text.length < 2) return { clinics: [], invoices: [], requests: [], payments: [] };
    const like = { contains: text, mode: 'insensitive' as const };
    const [clinics, invoices, requests, payments] = await Promise.all([
      this.db.tenant.findMany({
        where: { OR: [{ name: like }, { nameAm: like }, { phone: { contains: text } }, { users: { some: { phone: { contains: text } } } }] },
        select: { id: true, name: true, nameAm: true, address: true, subscription: { select: { status: true, trialEndsAt: true, paidUntil: true, graceDays: true, suspendedAt: true, cancelledAt: true } } },
        orderBy: { name: 'asc' },
        take: 6,
      }),
      this.db.platformInvoice.findMany({ where: { number: like }, orderBy: { issuedAt: 'desc' }, take: 5, select: { id: true, number: true, tenantId: true, total: true, status: true } }),
      this.db.clinicRequest.findMany({
        where: { OR: [{ reference: like }, { clinicName: like }, { contactPhone: { contains: text } }, { contactName: like }] },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, reference: true, clinicName: true, status: true, contactPhone: true },
      }),
      this.db.platformPayment.findMany({ where: { reference: like }, orderBy: { paidAt: 'desc' }, take: 5, select: { id: true, reference: true, tenantId: true, amount: true, status: true, method: true } }),
    ]);
    const names = await this.clinicNames([...invoices, ...payments].map((x) => x.tenantId));
    return {
      clinics: clinics.map(({ subscription, ...c }) => ({ ...c, state: subscription ? subscriptionState(subscription).state : null })),
      invoices: invoices.map((i) => ({ ...i, clinic: names.get(i.tenantId) ?? '' })),
      requests,
      payments: payments.map((p) => ({ ...p, clinic: names.get(p.tenantId) ?? '' })),
    };
  }
}

import { BadRequestException, Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { clinicDay, dayRange, isDay } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { licenceSigningProblem } from '../licence/licence.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { schemaVersion } from '../sync/engine.js';
import { onlineMethods, publicUrl } from './payments/checkout.js';
import { PlatformGuard } from './platform-auth.js';
import { daysLate, monthOf } from './revenue.js';
import { subscriptionState } from './subscription-state.js';

const DAY = 86_400_000;
const uuid = z.uuid();
const money = (cents: number) => fromCents(Math.round(cents));
/** Invoices listed in the VAT register at most (the totals always cover the whole period). */
const REGISTER_ROWS = 20_000;
/** A clinic server not heard from for a day is offline. */
const OFFLINE_AFTER_MS = DAY;

/** "from" and "to" as Addis Ababa days (both included), checked: [start, end) as instants. */
function period(from: string | undefined, to: string | undefined, fallbackFrom: string) {
  const f = from || fallbackFrom;
  const t = to || clinicDay();
  if (!isDay(f) || !isDay(t)) throw new BadRequestException('Days look like 2026-11-19');
  if (f > t) throw new BadRequestException('"From" is after "to"');
  if (Date.parse(t) - Date.parse(f) > 10 * 366 * DAY) throw new BadRequestException('Choose at most ten years');
  return { from: f, to: t, start: dayRange(f).start, end: dayRange(t).end };
}

/**
 * The console's accounts and health: a clinic's statement of account, invoiced and collected by
 * month, the VAT sales register, and what needs a technician (servers, online payments, licences,
 * configuration). Read-only.
 */
@Controller('platform')
@Public()
@UseGuards(PlatformGuard)
export class PlatformReportsController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.system;
  }

  // ─── Statement of account ────────────────────────────────────────────────────────────────────
  /**
   * Everything billed to a clinic and everything it paid, in date order with a running balance:
   * what was owed at the start, each invoice (voided ones left out), each confirmed payment, and
   * what is owed at the end. A negative balance is money the clinic has paid ahead.
   */
  @Get('clinics/:id/statement')
  async statement(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (!uuid.safeParse(id).success) throw new NotFoundException();
    const tenant = await this.db.tenant.findUnique({ where: { id }, select: { id: true, name: true, nameAm: true, address: true, phone: true, tin: true, createdAt: true } });
    if (!tenant) throw new NotFoundException();
    const p = period(from, to, clinicDay(tenant.createdAt));
    const [invoices, payments, settings, unpaid] = await Promise.all([
      this.db.platformInvoice.findMany({
        where: { tenantId: id, status: { not: 'VOID' }, issuedAt: { lt: p.end } },
        orderBy: { issuedAt: 'asc' },
        include: { payments: { where: { status: 'CONFIRMED' }, select: { amount: true } } },
      }),
      this.db.platformPayment.findMany({
        where: { tenantId: id, status: 'CONFIRMED', paidAt: { lt: p.end } },
        orderBy: { paidAt: 'asc' },
        include: { invoice: { select: { number: true } } },
      }),
      this.db.platformSetting.findUniqueOrThrow({ where: { id: 1 }, select: { bankDetails: true, supportPhone: true, supportEmail: true, companyName: true, companyTin: true, companyAddress: true } }),
      // What is unpaid today, whatever period is shown (an invoice issued after it included).
      this.db.platformInvoice.findMany({
        where: { tenantId: id, status: 'OPEN' },
        orderBy: { dueDate: 'asc' },
        include: { payments: { where: { status: 'CONFIRMED' }, select: { amount: true } } },
      }),
    ]);
    const opening =
      invoices.filter((i) => i.issuedAt < p.start).reduce((sum, i) => sum + toCents(i.total), 0) -
      payments.filter((x) => x.paidAt < p.start).reduce((sum, x) => sum + toCents(x.amount), 0);
    type Line = { at: Date; kind: 'INVOICE' | 'PAYMENT'; id: string; reference: string; description: string; method?: string; debit: number; credit: number };
    const lines: Line[] = [
      ...invoices
        .filter((i) => i.issuedAt >= p.start)
        .map((i) => ({
          at: i.issuedAt,
          kind: 'INVOICE' as const,
          id: i.id,
          reference: i.number,
          description: `${i.planName} plan, ${i.cycle === 'YEARLY' ? 'yearly' : 'monthly'}: ${clinicDay(i.periodStart)} to ${clinicDay(i.periodEnd)}`,
          debit: toCents(i.total),
          credit: 0,
        })),
      ...payments
        .filter((x) => x.paidAt >= p.start)
        .map((x) => ({
          at: x.paidAt,
          kind: 'PAYMENT' as const,
          id: x.id,
          reference: x.reference ?? '',
          description: `Payment for ${x.invoice.number}`,
          method: x.method,
          debit: 0,
          credit: toCents(x.amount),
        })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === b.kind ? 0 : a.kind === 'INVOICE' ? -1 : 1));
    let balance = opening;
    const now = new Date();
    return {
      clinic: tenant,
      issuer: { ...settings, publicUrl: publicUrl() },
      period: { from: p.from, to: p.to },
      opening: money(opening),
      lines: lines.map((l) => {
        balance += l.debit - l.credit;
        return { ...l, debit: money(l.debit), credit: money(l.credit), balance: money(balance) };
      }),
      totals: { invoiced: money(lines.reduce((s, l) => s + l.debit, 0)), paid: money(lines.reduce((s, l) => s + l.credit, 0)) },
      closing: money(balance),
      open: unpaid.map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, total: i.total, balance: money(Math.max(0, toCents(i.total) - i.payments.reduce((s, x) => s + toCents(x.amount), 0))), daysLate: daysLate(i.dueDate, now) })),
    };
  }

  // ─── Invoiced and collected, by month ────────────────────────────────────────────────────────
  @Get('reports/sales')
  async sales(@Query('year') year?: string) {
    const y = year && /^\d{4}$/.test(year) ? Number(year) : Number(clinicDay().slice(0, 4));
    if (y < 2000 || y > 2100) throw new BadRequestException('A year like 2026');
    const start = new Date(`${y}-01-01T00:00:00+03:00`);
    const end = new Date(`${y + 1}-01-01T00:00:00+03:00`);
    const [invoices, payments, first] = await Promise.all([
      this.db.platformInvoice.findMany({ where: { issuedAt: { gte: start, lt: end } }, select: { issuedAt: true, status: true, subtotal: true, vat: true, total: true } }),
      this.db.platformPayment.findMany({ where: { status: 'CONFIRMED', paidAt: { gte: start, lt: end } }, select: { paidAt: true, amount: true } }),
      this.db.platformInvoice.findFirst({ orderBy: { issuedAt: 'asc' }, select: { issuedAt: true } }),
    ]);
    const months = Array.from({ length: 12 }, (_, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, invoices: 0, voided: 0, subtotal: 0, vat: 0, total: 0, collected: 0 }));
    const at = (d: Date) => months[Number(monthOf(d).slice(5, 7)) - 1];
    for (const i of invoices) {
      const m = at(i.issuedAt);
      if (i.status === 'VOID') {
        m.voided++;
        continue;
      }
      m.invoices++;
      m.subtotal += toCents(i.subtotal);
      m.vat += toCents(i.vat);
      m.total += toCents(i.total);
    }
    for (const x of payments) at(x.paidAt).collected += toCents(x.amount);
    const sum = (k: 'subtotal' | 'vat' | 'total' | 'collected') => money(months.reduce((s, m) => s + m[k], 0));
    const firstYear = first ? Number(clinicDay(first.issuedAt).slice(0, 4)) : y;
    return {
      year: y,
      years: Array.from({ length: Math.max(1, Number(clinicDay().slice(0, 4)) - firstYear + 1) }, (_, i) => firstYear + i).reverse(),
      months: months.map((m) => ({ ...m, subtotal: money(m.subtotal), vat: money(m.vat), total: money(m.total), collected: money(m.collected) })),
      totals: { invoices: months.reduce((s, m) => s + m.invoices, 0), voided: months.reduce((s, m) => s + m.voided, 0), subtotal: sum('subtotal'), vat: sum('vat'), total: sum('total'), collected: sum('collected') },
    };
  }

  /**
   * The VAT sales register: every invoice issued between two days, with the buyer's TIN. Voided
   * invoices are listed (numbers must not go missing) but count for nothing.
   */
  @Get('reports/vat-register')
  async vatRegister(@Query('from') from?: string, @Query('to') to?: string) {
    const p = period(from, to, `${clinicDay().slice(0, 7)}-01`);
    const inPeriod = { issuedAt: { gte: p.start, lt: p.end } };
    const noTin = (await this.db.tenant.findMany({ where: { OR: [{ tin: null }, { tin: '' }] }, select: { id: true } })).map((t) => t.id);
    const [invoices, sums, voided, withoutTin] = await Promise.all([
      this.db.platformInvoice.findMany({
        where: inPeriod,
        orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
        take: REGISTER_ROWS,
        select: { id: true, number: true, tenantId: true, issuedAt: true, status: true, planName: true, subtotal: true, vat: true, total: true, voidReason: true },
      }),
      // The totals over the whole period, however many rows are listed.
      this.db.platformInvoice.aggregate({ where: { ...inPeriod, status: { not: 'VOID' } }, _count: true, _sum: { subtotal: true, vat: true, total: true } }),
      this.db.platformInvoice.count({ where: { ...inPeriod, status: 'VOID' } }),
      this.db.platformInvoice.count({ where: { ...inPeriod, status: { not: 'VOID' }, tenantId: { in: noTin } } }),
    ]);
    const tenants = await this.db.tenant.findMany({ where: { id: { in: [...new Set(invoices.map((i) => i.tenantId))] } }, select: { id: true, name: true, tin: true } });
    const clinic = new Map(tenants.map((t) => [t.id, t]));
    const sum = (v: { toString(): string } | null) => money(v ? toCents(v) : 0);
    return {
      period: { from: p.from, to: p.to },
      invoices: invoices.map((i) => ({ ...i, clinic: clinic.get(i.tenantId)?.name ?? '', tin: clinic.get(i.tenantId)?.tin || null })),
      // More invoices than listed: the totals still cover them all.
      truncated: sums._count + voided > invoices.length,
      totals: { invoices: sums._count, voided, subtotal: sum(sums._sum.subtotal), vat: sum(sums._sum.vat), total: sum(sums._sum.total), withoutTin },
    };
  }

  // ─── Health ──────────────────────────────────────────────────────────────────────────────────
  /** What needs a technician or a phone call before a clinic notices. */
  @Get('health')
  async health() {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY);
    const [servers, cloudVersion, checkouts, failed, unapplied, subs, settings] = await Promise.all([
      this.db.syncClient.findMany({ where: { revokedAt: null }, select: { id: true, tenantId: true, name: true, lastSeenAt: true, lastError: true, edgeVersion: true, createdAt: true } }),
      schemaVersion(this.db),
      this.db.platformCheckout.groupBy({ by: ['provider', 'status'], where: { createdAt: { gte: since } }, _count: true }),
      this.db.platformCheckout.findMany({ where: { status: 'FAILED', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.db.platformCheckout.count({ where: { status: 'PAID', paymentId: null } }),
      this.db.subscription.findMany({ where: { deployment: { not: 'CLOUD' } }, include: { plan: { select: { name: true } } } }),
      this.db.platformSetting.findUniqueOrThrow({ where: { id: 1 }, select: { companyName: true, companyTin: true, bankDetails: true, supportPhone: true } }),
    ]);
    const names = new Map(
      (await this.db.tenant.findMany({ where: { id: { in: [...new Set([...servers.map((s) => s.tenantId), ...failed.map((f) => f.tenantId), ...subs.map((s) => s.tenantId)])] } }, select: { id: true, name: true } })).map((t) => [
        t.id,
        t.name,
      ]),
    );
    // Never connected: still being set up for its first day, then a problem.
    const status = (s: (typeof servers)[number]): 'never' | 'new' | 'offline' | 'error' | 'ok' =>
      !s.lastSeenAt ? (now.getTime() - s.createdAt.getTime() > OFFLINE_AFTER_MS ? 'never' : 'new') : now.getTime() - s.lastSeenAt.getTime() > OFFLINE_AFTER_MS ? 'offline' : s.lastError ? 'error' : 'ok';
    const order = { offline: 0, never: 1, error: 2, new: 3, ok: 4 } as const;
    const serverRows = servers
      .map((s) => ({ ...s, clinic: names.get(s.tenantId) ?? '', status: status(s), behind: !!s.edgeVersion && s.edgeVersion < cloudVersion }))
      .sort((a, b) => order[a.status] - order[b.status] || (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0));
    // Own-server and clinic-server clinics need a licence for each new period: those ending soon.
    const licences = subs
      .map((s) => ({ s, st: subscriptionState(s, now) }))
      .filter(({ st }) => st.state !== 'cancelled' && st.state !== 'suspended' && st.endsAt && st.daysLeft !== null && st.daysLeft <= 14)
      .map(({ s, st }) => ({ tenantId: s.tenantId, clinic: names.get(s.tenantId) ?? '', deployment: s.deployment, plan: s.plan.name, state: st.state, endsAt: st.endsAt, daysLeft: st.daysLeft }))
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    const online = onlineMethods();
    const signing = licenceSigningProblem();
    return {
      cloudVersion,
      servers: serverRows,
      checkouts: {
        byProvider: (['CHAPA', 'TELEBIRR'] as const).map((provider) => {
          const of = (st: string) => checkouts.find((c) => c.provider === provider && c.status === st)?._count ?? 0;
          return { provider, paid: of('PAID'), failed: of('FAILED'), expired: of('EXPIRED'), waiting: of('CREATED') };
        }),
        failed: failed.map((f) => ({ id: f.id, reference: f.reference, provider: f.provider, tenantId: f.tenantId, clinic: names.get(f.tenantId) ?? '', amount: f.amount, createdAt: f.createdAt, lastError: f.lastError })),
        unapplied,
      },
      licences,
      setup: [
        { key: 'publicUrl', ok: !!publicUrl(), label: 'Public address (HMIS_PUBLIC_URL)', fix: 'Needed for online payments and the links on invoices.' },
        { key: 'chapa', ok: online.CHAPA, label: 'Chapa', fix: 'Set the Chapa keys on the server to take card and mobile payments.' },
        { key: 'telebirr', ok: online.TELEBIRR, label: 'telebirr', fix: 'Set the telebirr merchant keys on the server.' },
        { key: 'licences', ok: !signing, label: 'Licence signing', fix: signing ?? '' },
        { key: 'company', ok: !!(settings.companyName && settings.companyTin), label: 'Company name and TIN on invoices', fix: 'Settings → On every invoice.' },
        { key: 'bank', ok: !!settings.bankDetails, label: 'Bank details for transfers', fix: 'Settings: clinics paying by transfer need them.' },
        { key: 'support', ok: !!settings.supportPhone, label: 'Support phone', fix: 'Settings: shown to clinics.' },
      ],
    };
  }
}

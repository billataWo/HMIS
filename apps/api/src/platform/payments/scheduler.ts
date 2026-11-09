import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Db } from '@hmis/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import { issueInvoice, nextPeriodStart } from '../billing.js';
import { platformEnabled } from '../platform-auth.js';
import { settleCheckout } from './checkout.js';

const DAY = 86_400_000;
const log = new Logger('Subscriptions');

/**
 * Renewal invoices: each clinic's next invoice, `invoiceDaysBefore` days before its trial or paid
 * period ends (one open invoice at a time). Not for clinics without an end date, suspended or
 * cancelled by HMIS, or whose last invoice HMIS voided (HMIS then decides by hand).
 */
export async function issueRenewalInvoices(db: Db, now = new Date()) {
  const settings = await db.platformSetting.findUnique({ where: { id: 1 } });
  if (!settings?.autoInvoice) return [];
  const horizon = new Date(now.getTime() + settings.invoiceDaysBefore * DAY);
  const subs = await db.subscription.findMany({
    where: {
      status: { not: 'CANCELLED' },
      cancelledAt: null,
      suspendedAt: null,
      OR: [
        { status: 'TRIAL', trialEndsAt: { not: null, lte: horizon } },
        { status: 'ACTIVE', paidUntil: { not: null, lte: horizon } },
      ],
    },
    include: { invoices: { orderBy: { issuedAt: 'desc' }, take: 1 } },
  });
  const issued: string[] = [];
  for (const sub of subs) {
    const last = sub.invoices[0];
    if (last?.status === 'OPEN' || last?.status === 'VOID') continue;
    // Already invoiced for this period (paid, but the period has not been extended yet: never).
    if (last && last.periodStart.getTime() === nextPeriodStart(sub, now).getTime()) continue;
    try {
      const invoice = await issueInvoice(db, sub.tenantId, null, now);
      await db.platformAuditLog.create({ data: { action: 'invoice.issued', entity: 'PlatformInvoice', entityId: invoice.id, tenantId: sub.tenantId, data: { number: invoice.number, total: invoice.total.toString(), automatic: true } } });
      issued.push(invoice.number);
    } catch (e) {
      log.error(`Renewal invoice for ${sub.tenantId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return issued;
}

/**
 * Online payments whose confirmation never arrived (the payer closed the page, a webhook was lost):
 * ask the provider again for a day, then give up on them.
 */
export async function reconcileCheckouts(db: Db, now = new Date()) {
  const waiting = await db.platformCheckout.findMany({
    where: { status: 'CREATED', checkoutUrl: { not: null }, createdAt: { lte: new Date(now.getTime() - 2 * 60_000), gte: new Date(now.getTime() - DAY) } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  let paid = 0;
  for (const c of waiting) if ((await settleCheckout(db, c.reference)).status === 'PAID') paid += 1;
  const expired = await db.platformCheckout.updateMany({ where: { status: 'CREATED', createdAt: { lt: new Date(now.getTime() - DAY) } }, data: { status: 'EXPIRED' } });
  return { checked: waiting.length, paid, expired: expired.count };
}

/**
 * Runs both every five minutes on the HMIS cloud. With several API processes, a database lock
 * lets only one of them do it at a time. HMIS_SCHEDULER=0 turns it off (tests run it directly).
 */
@Injectable()
export class SubscriptionScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private lastInvoiceRun = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!platformEnabled() || process.env.HMIS_SCHEDULER === '0') return;
    this.timer = setInterval(() => void this.tick(), 5 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.tick(), 30_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const db = this.prisma.system;
    try {
      await db.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(72110001) AS locked`;
          if (!locked) return;
          const checkouts = await reconcileCheckouts(db);
          if (checkouts.checked || checkouts.expired) log.log(`Online payments: ${checkouts.checked} checked, ${checkouts.paid} paid, ${checkouts.expired} expired`);
          if (Date.now() - this.lastInvoiceRun >= 60 * 60_000) {
            this.lastInvoiceRun = Date.now();
            const issued = await issueRenewalInvoices(db);
            if (issued.length) log.log(`Renewal invoices issued: ${issued.join(', ')}`);
          }
        },
        { timeout: 10 * 60_000, maxWait: 10_000 },
      );
    } catch (e) {
      log.error(`Scheduler: ${e instanceof Error ? e.message : e}`);
    }
  }
}

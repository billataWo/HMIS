import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ETHIOPIAN_MONTHS, ETHIOPIAN_MONTHS_AM, ethiopianMonthRange, toEthiopian } from '../common/ethiopian-calendar.js';
import { fromCents, toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { EXPIRY_WARNING_DAYS } from '../inventory/inventory.controller.js';
import { targetMinutes } from '../lab/lab.controller.js';
import { patientDue, payerDue } from '../billing/billing.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { immunizationTally } from '../immunization/immunization.controller.js';
import { ancTally } from '../anc/anc.controller.js';
import { fpTally } from '../family-planning/fp.controller.js';
import { AGE_GROUPS, ageAt, ageGroup } from './age.js';

export { AGE_GROUPS, ageAt, ageGroup };

const RangeSchema = z.object({
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
});
const MonthSchema = z.object({
  ecYear: z.coerce.number().int().min(1990).max(2100).optional(),
  ecMonth: z.coerce.number().int().min(1).max(13).optional(),
});


/** Counts items by key, most frequent first. */
function tally<T>(items: T[], key: (t: T) => string, take = 10) {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, take);
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return Math.round(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
}

type TatOrder = {
  urgent: boolean;
  orderedAt: Date;
  sampleCollectedAt: Date | null;
  verifiedAt: Date | null;
  amendedAt: Date | null;
  labTest: { name: string; tatMinutes: number | null };
};

/**
 * Lab turnaround for released tests: sample taken to result released (the lab's own time), and
 * order to release (what the doctor waits, including the cashier). Targets are today's settings.
 * Amended results are left out: their release time is the amendment's.
 */
export function labTurnaround(orders: TatOrder[], urgentMinutes: number) {
  const done = orders
    .filter((o) => o.verifiedAt && o.sampleCollectedAt && !o.amendedAt)
    .map((o) => ({
      o,
      lab: (o.verifiedAt!.getTime() - o.sampleCollectedAt!.getTime()) / 60000,
      total: (o.verifiedAt!.getTime() - o.orderedAt.getTime()) / 60000,
      target: targetMinutes(o.urgent, o.labTest.tatMinutes, urgentMinutes),
    }));
  const summary = (xs: typeof done) => {
    const targeted = xs.filter((x) => x.target !== null);
    return {
      count: xs.length,
      medianMinutes: median(xs.map((x) => x.lab)),
      withTarget: targeted.length,
      onTime: targeted.filter((x) => x.lab <= x.target!).length,
    };
  };
  const byTest = new Map<string, typeof done>();
  for (const x of done) byTest.set(x.o.labTest.name, [...(byTest.get(x.o.labTest.name) ?? []), x]);
  return {
    ...summary(done),
    orderToReleaseMinutes: median(done.map((x) => x.total)),
    urgent: summary(done.filter((x) => x.o.urgent)),
    // Tests that most often missed their target, then the slowest.
    tests: [...byTest.entries()]
      .map(([name, xs]) => ({ name, ...summary(xs), targetMinutes: xs[0].o.labTest.tatMinutes }))
      .sort((a, b) => b.withTarget - b.onTime - (a.withTarget - a.onTime) || (b.medianMinutes ?? 0) - (a.medianMinutes ?? 0))
      .slice(0, 8),
  };
}

function daysBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

/** Hour (0–23) and weekday (0 = Monday) on a clock in Addis Ababa: UTC+3 all year. */
export function clinicClock(at: Date) {
  const local = new Date(at.getTime() + 3 * 3_600_000);
  return { hour: local.getUTCHours(), weekday: (local.getUTCDay() + 6) % 7 };
}

/** The value below which `p` (0–1) of the numbers fall (nearest rank), rounded to whole minutes. */
function percentile(xs: number[], p: number) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]);
}

const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Minutes from check-in to the doctor calling the patient in. */
const waitOf = (v: { checkedInAt: Date; calledAt: Date | null }) => (v.calledAt ? (v.calledAt.getTime() - v.checkedInAt.getTime()) / 60000 : null);

/** Wait-time bands for the spread of waits: under 15 min, 15–30, 30–60, 1–2 h, over 2 h. */
export const WAIT_BANDS = [15, 30, 60, 120] as const;

const SOURCES = ['CONSULTATION', 'LAB', 'PHARMACY', 'PROCEDURE', 'OTHER'] as const;

@Controller('reports')
@Roles('ADMIN')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Owner's dashboard for a range of clinic days (inclusive, default today, at most a year). */
  @Get('dashboard')
  async dashboard(@CurrentUser() me: AuthUser, @Query(new ZodPipe(RangeSchema)) q: z.infer<typeof RangeSchema>) {
    const today = clinicDay();
    const from = q.from ?? today;
    const to = q.to ?? from;
    if (from > to) throw new BadRequestException('"from" must be on or before "to"');
    const days = daysBetween(from, to);
    if (days.length > 366) throw new BadRequestException('Choose a range of at most one year');

    const start = dayRange(from).start;
    const end = dayRange(to).end;
    const range = { gte: start, lt: end };
    const t = me.tenantId;
    const db = this.prisma.client;
    const todayStart = dayRange(today).start;
    const soon = new Date(todayStart.getTime() + EXPIRY_WARNING_DAYS * 86_400_000);

    // The period just before, of the same length, for "up 12% on the previous 7 days".
    const prevFrom = shiftDay(from, -days.length);
    const prevRange = { gte: dayRange(prevFrom).start, lt: start };

    const [visits, registered, payments, invoices, outstanding, charges, diagnoses, labOrders, dispensed, drugs, losses] =
      await Promise.all([
        db.visit.findMany({
          where: { tenantId: t, kind: 'OPD', checkedInAt: range, status: { not: 'CANCELLED' } },
          select: {
            checkedInAt: true,
            calledAt: true,
            status: true,
            doctor: { select: { fullName: true } },
            patient: { select: { sex: true, dateOfBirth: true } },
          },
        }),
        db.patient.findMany({ where: { tenantId: t, createdAt: range }, select: { createdAt: true } }),
        db.payment.findMany({ where: { tenantId: t, receivedAt: range }, select: { amount: true, method: true, receivedAt: true } }),
        db.invoice.findMany({
          where: { tenantId: t, createdAt: range, status: { not: 'VOID' } },
          select: { total: true, discount: true, discountCategory: true, createdAt: true },
        }),
        db.invoice.findMany({
          where: { tenantId: t, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
          select: { total: true, paid: true, payerType: true, payerName: true, patientShare: true, patientPaid: true, createdAt: true },
        }),
        // Every service delivered in the period (not removed from a bill): by department, what
        // pharmacy sold, and what nobody has invoiced yet.
        db.charge.findMany({
          where: { visit: { tenantId: t }, voidedAt: null, createdAt: range },
          select: { source: true, unitPrice: true, quantity: true, invoiceId: true },
        }),
        db.diagnosis.findMany({
          where: { visit: { tenantId: t, checkedInAt: range, status: { not: 'CANCELLED' } } },
          select: { icd11Code: true, label: true },
        }),
        db.labOrder.findMany({
          where: { tenantId: t, orderedAt: range, status: { not: 'CANCELLED' } },
          select: {
            status: true,
            resultFlag: true,
            urgent: true,
            orderedAt: true,
            sampleCollectedAt: true,
            verifiedAt: true,
            amendedAt: true,
            labTest: { select: { name: true, tatMinutes: true } },
          },
        }),
        db.stockMovement.findMany({
          where: { type: 'DISPENSE', createdAt: range, batch: { drug: { tenantId: t } } },
          select: { quantity: true, batch: { select: { drug: { select: { genericName: true } } } } },
        }),
        db.drug.findMany({
          where: { tenantId: t, active: true },
          select: { reorderLevel: true, batches: { where: { quantity: { gt: 0 } }, select: { quantity: true, costPrice: true, expiryDate: true } } },
        }),
        db.stockMovement.findMany({
          where: { createdAt: range, batch: { drug: { tenantId: t } }, OR: [{ type: 'EXPIRED' }, { type: 'ADJUSTMENT', quantity: { lt: 0 } }] },
          select: { type: true, quantity: true, batch: { select: { costPrice: true } } },
        }),
      ]);

    const [{ labUrgentMinutes }, cancelled, previous, now] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: t }, select: { labUrgentMinutes: true } }),
      // Visits cancelled, by why: patients who left without being seen are the front desk's warning sign.
      db.visit.groupBy({ by: ['cancelReason'], where: { tenantId: t, kind: 'OPD', checkedInAt: range, status: 'CANCELLED' }, _count: { _all: true } }),
      this.periodTotals(t, prevRange),
      // What is happening right now, when the period runs to today.
      to === today ? this.rightNow(t, todayStart) : null,
    ]);
    const waits = visits.map(waitOf).filter((w): w is number => w !== null);
    const byMethod: Record<string, number> = {};
    for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + toCents(p.amount);
    const collected = payments.reduce((s, p) => s + toCents(p.amount), 0);

    // What is owed, split by who owes it (on a payer's invoice the patient owes their co-payment),
    // and how old it is: 0–30, 31–60, 61–90 and over 90 days.
    const receivables = new Map<string, number>();
    const ageing = { patients: [0, 0, 0, 0], payers: [0, 0, 0, 0] };
    const bucket = (d: Date) => {
      const days = (Date.now() - d.getTime()) / 86_400_000;
      return days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    };
    let patientsOwe = 0;
    for (const i of outstanding) {
      const p = patientDue(i);
      const y = payerDue(i);
      patientsOwe += p;
      ageing.patients[bucket(i.createdAt)] += p;
      ageing.payers[bucket(i.createdAt)] += y;
      if (y > 0) {
        const k = `${i.payerType === 'CREDIT' ? 'Credit' : 'Insurance'}: ${i.payerName ?? 'unnamed'}`;
        receivables.set(k, (receivables.get(k) ?? 0) + y);
      }
    }
    // Discounts and exemptions in the period, by why they were given.
    const byCategory = new Map<string, { count: number; amount: number }>();
    for (const i of invoices.filter((x) => toCents(x.discount) > 0)) {
      const k = i.discountCategory ?? 'UNCATEGORISED';
      const e = byCategory.get(k) ?? { count: 0, amount: 0 };
      e.count += 1;
      e.amount += toCents(i.discount);
      byCategory.set(k, e);
    }

    const labels = new Map(diagnoses.map((d) => [d.icd11Code, d.label]));
    const dispensedByDrug = new Map<string, number>();
    for (const m of dispensed) dispensedByDrug.set(m.batch.drug.genericName, (dispensedByDrug.get(m.batch.drug.genericName) ?? 0) - m.quantity);

    let stockValue = 0;
    let low = 0;
    let expiring = 0;
    let expiredOnShelf = 0;
    for (const d of drugs) {
      const usable = d.batches.filter((b) => b.expiryDate >= todayStart);
      const onHand = usable.reduce((s, b) => s + b.quantity, 0);
      stockValue += usable.reduce((s, b) => s + b.quantity * toCents(b.costPrice), 0);
      if (d.reorderLevel > 0 && onHand <= d.reorderLevel) low++;
      if (usable.some((b) => b.expiryDate < soon)) expiring++;
      if (d.batches.some((b) => b.expiryDate < todayStart)) expiredOnShelf++;
    }
    const lossOf = (type: string) => losses.filter((l) => l.type === type).reduce((s, l) => s - l.quantity * toCents(l.batch.costPrice), 0);

    // Day by day: visits, new patients, money in, money billed and the average wait.
    const perDay = new Map(days.map((day) => [day, { visits: 0, newPatients: 0, collected: 0, billed: 0, waits: [] as number[] }]));
    const on = (at: Date) => perDay.get(clinicDay(at));
    for (const v of visits) {
      const d = on(v.checkedInAt);
      if (!d) continue;
      d.visits++;
      const w = waitOf(v);
      if (w !== null) d.waits.push(w);
    }
    for (const p of registered) {
      const d = on(p.createdAt);
      if (d) d.newPatients++;
    }
    for (const p of payments) {
      const d = on(p.receivedAt);
      if (d) d.collected += toCents(p.amount);
    }
    for (const i of invoices) {
      const d = on(i.createdAt);
      if (d) d.billed += toCents(i.total);
    }

    // When patients arrive: check-ins by weekday (Monday first) and hour of the day.
    const arrivals = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const v of visits) {
      const c = clinicClock(v.checkedInAt);
      arrivals[c.weekday][c.hour]++;
    }

    // Who came: by age group and sex, at the visit.
    const groups = [...AGE_GROUPS.map((g) => g.key), 'unknown'];
    const bySexAge = new Map(groups.map((g) => [g, { male: 0, female: 0 }]));
    for (const v of visits) bySexAge.get(ageGroup(ageAt(v.patient.dateOfBirth, v.checkedInAt)))![v.patient.sex === 'MALE' ? 'male' : 'female']++;

    const amountOf = (xs: { unitPrice: { toString(): string }; quantity: number }[]) => xs.reduce((s, c) => s + toCents(c.unitPrice) * c.quantity, 0);
    const unbilled = charges.filter((c) => c.invoiceId === null);

    return {
      from,
      to,
      previous,
      now,
      patients: {
        visits: visits.length,
        completed: visits.filter((v) => v.status === 'COMPLETED').length,
        seen: waits.length,
        newPatients: registered.length,
        avgWaitMinutes: average(waits),
        medianWaitMinutes: median(waits),
        p90WaitMinutes: percentile(waits, 0.9),
        // Under 15 min, 15–30, 30–60, 1–2 h, over 2 h.
        waitBands: [...WAIT_BANDS, Infinity].map((top, i) => waits.filter((w) => w < top && w >= (WAIT_BANDS[i - 1] ?? 0)).length),
        arrivals,
        bySexAge: groups.map((g) => ({ ageGroup: g, ...bySexAge.get(g)! })),
        byDoctor: tally(visits.filter((v) => v.doctor), (v) => v.doctor!.fullName).map(([name, count]) => ({ name, count })),
        cancelled: cancelled.reduce((n, c) => n + c._count._all, 0),
        cancelledByReason: Object.fromEntries(cancelled.map((c) => [c.cancelReason ?? 'NOT_GIVEN', c._count._all])),
      },
      revenue: {
        collected: fromCents(collected),
        byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, fromCents(v)])),
        billed: fromCents(invoices.reduce((s, i) => s + toCents(i.total), 0)),
        discounts: fromCents(invoices.reduce((s, i) => s + toCents(i.discount), 0)),
        // Services delivered in the range that nobody has invoiced yet: the leakage indicator.
        unbilled: fromCents(amountOf(unbilled)),
        unbilledCount: unbilled.length,
        // What each department delivered (at the price charged), billed or not.
        bySource: SOURCES.map((source) => ({ source, amount: fromCents(amountOf(charges.filter((c) => c.source === source))) })),
        patientsOwe: fromCents(patientsOwe),
        receivables: [...receivables.entries()].sort((a, b) => b[1] - a[1]).map(([payer, due]) => ({ payer, due: fromCents(due) })),
        ageing: { patients: ageing.patients.map(fromCents), payers: ageing.payers.map(fromCents) },
        discountsBy: [...byCategory.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([category, e]) => ({ category, count: e.count, amount: fromCents(e.amount) })),
      },
      topDiagnoses: tally(diagnoses, (d) => d.icd11Code).map(([code, count]) => ({ code, label: labels.get(code) ?? code, count })),
      lab: {
        ordered: labOrders.length,
        verified: labOrders.filter((o) => o.status === 'VERIFIED').length,
        abnormal: labOrders.filter((o) => !!o.resultFlag && o.resultFlag !== 'N').length,
        critical: labOrders.filter((o) => o.resultFlag === 'LL' || o.resultFlag === 'HH').length,
        topTests: tally(labOrders, (o) => o.labTest.name, 5).map(([name, count]) => ({ name, count })),
        urgent: labOrders.filter((o) => o.urgent).length,
        turnaround: labTurnaround(labOrders.filter((o) => o.status === 'VERIFIED'), labUrgentMinutes),
      },
      pharmacy: {
        sales: fromCents(amountOf(charges.filter((c) => c.source === 'PHARMACY'))),
        unitsDispensed: [...dispensedByDrug.values()].reduce((a, b) => a + b, 0),
        topDrugs: [...dispensedByDrug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, units]) => ({ name, units })),
      },
      stock: {
        value: fromCents(stockValue),
        low,
        expiring,
        expiredOnShelf,
        expiredLoss: fromCents(lossOf('EXPIRED')),
        adjustmentLoss: fromCents(lossOf('ADJUSTMENT')),
      },
      daily: days.map((day) => {
        const d = perDay.get(day)!;
        return { day, visits: d.visits, newPatients: d.newPatients, collected: fromCents(d.collected), billed: fromCents(d.billed), avgWaitMinutes: average(d.waits) };
      }),
    };
  }

  /** The headline numbers of an earlier period, to compare against. */
  private async periodTotals(t: string, range: { gte: Date; lt: Date }) {
    const db = this.prisma.client;
    const [visits, newPatients, payments, billed, unbilled] = await Promise.all([
      db.visit.findMany({ where: { tenantId: t, kind: 'OPD', checkedInAt: range, status: { not: 'CANCELLED' } }, select: { checkedInAt: true, calledAt: true, status: true } }),
      db.patient.count({ where: { tenantId: t, createdAt: range } }),
      db.payment.findMany({ where: { tenantId: t, receivedAt: range }, select: { amount: true, receivedAt: true } }),
      db.invoice.aggregate({ where: { tenantId: t, createdAt: range, status: { not: 'VOID' } }, _sum: { total: true } }),
      db.charge.findMany({ where: { visit: { tenantId: t }, voidedAt: null, invoiceId: null, createdAt: range }, select: { unitPrice: true, quantity: true } }),
    ]);
    const waits = visits.map(waitOf).filter((w): w is number => w !== null);
    const from = clinicDay(range.gte);
    const to = clinicDay(new Date(range.lt.getTime() - 1));
    // Day by day too, so a chart can lay this period under the one shown.
    const index = new Map(daysBetween(from, to).map((day, i) => [day, i]));
    const visitsByDay = Array<number>(index.size).fill(0);
    const cashByDay = Array<number>(index.size).fill(0);
    for (const v of visits) {
      const i = index.get(clinicDay(v.checkedInAt));
      if (i !== undefined) visitsByDay[i]++;
    }
    for (const p of payments) {
      const i = index.get(clinicDay(p.receivedAt));
      if (i !== undefined) cashByDay[i] += toCents(p.amount);
    }
    return {
      from,
      to,
      visits: visits.length,
      completed: visits.filter((v) => v.status === 'COMPLETED').length,
      newPatients,
      collected: fromCents(cashByDay.reduce((a, b) => a + b, 0)),
      daily: { visits: visitsByDay, collected: cashByDay.map(fromCents) },
      billed: fromCents(toCents(billed._sum.total ?? 0)),
      avgWaitMinutes: average(waits),
      unbilled: fromCents(unbilled.reduce((s, c) => s + toCents(c.unitPrice) * c.quantity, 0)),
    };
  }

  /** Today, right now: who is where in the clinic, and the work waiting in each department. */
  private async rightNow(t: string, todayStart: Date) {
    const db = this.prisma.client;
    const today = { gte: todayStart };
    const [byStatus, longest, toCollect, toVerify, toDispense, toPay] = await Promise.all([
      db.visit.groupBy({
        by: ['status'],
        where: { tenantId: t, kind: 'OPD', checkedInAt: today, status: { in: ['WAITING', 'IN_CONSULTATION', 'AWAITING_LAB', 'AWAITING_PHARMACY'] } },
        _count: { _all: true },
      }),
      db.visit.findFirst({ where: { tenantId: t, kind: 'OPD', checkedInAt: today, status: 'WAITING' }, orderBy: { checkedInAt: 'asc' }, select: { checkedInAt: true } }),
      db.labOrder.count({ where: { tenantId: t, status: 'ORDERED', orderedAt: today } }),
      db.labOrder.count({ where: { tenantId: t, status: 'RESULTED' } }),
      db.prescription.count({ where: { tenantId: t, status: { in: ['PENDING', 'PARTIALLY_DISPENSED'] }, createdAt: today } }),
      db.visit.count({ where: { tenantId: t, checkedInAt: today, status: { not: 'CANCELLED' }, charges: { some: { invoiceId: null, voidedAt: null } } } }),
    ]);
    const count = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
    return {
      at: new Date().toISOString(),
      waiting: count('WAITING'),
      inConsultation: count('IN_CONSULTATION'),
      awaitingLab: count('AWAITING_LAB'),
      awaitingPharmacy: count('AWAITING_PHARMACY'),
      longestWaitMinutes: longest ? Math.floor((Date.now() - longest.checkedInAt.getTime()) / 60000) : null,
      samplesToTake: toCollect,
      resultsToVerify: toVerify,
      prescriptionsToDispense: toDispense,
      visitsToBill: toPay,
    };
  }

  /**
   * Monthly OPD report for an Ethiopian calendar month (the period HMIS/DHIS2 reporting uses):
   * visits by age group and sex, new vs repeat, top causes of morbidity, malaria testing.
   */
  @Get('moh-monthly')
  async mohMonthly(@CurrentUser() me: AuthUser, @Query(new ZodPipe(MonthSchema)) q: z.infer<typeof MonthSchema>) {
    const now = toEthiopian(clinicDay());
    const year = q.ecYear ?? now.year;
    const month = q.ecMonth ?? now.month;
    const { startDay, endDay } = ethiopianMonthRange(year, month);
    const range = { gte: dayRange(startDay).start, lt: dayRange(endDay).start };
    const db = this.prisma.client;
    const t = me.tenantId;

    const [tenant, visits, malaria, referralsOut, referralsIn, immunization, anc, familyPlanning] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: t }, select: { name: true, nameAm: true, address: true } }),
      db.visit.findMany({
        where: { tenantId: t, kind: 'OPD', checkedInAt: range, status: { not: 'CANCELLED' } },
        select: {
          patientId: true,
          checkedInAt: true,
          patient: { select: { sex: true, dateOfBirth: true } },
          diagnoses: { where: { isPrimary: true }, select: { icd11Code: true, label: true } },
        },
      }),
      db.labOrder.findMany({
        where: { tenantId: t, status: 'VERIFIED', verifiedAt: range, labTest: { name: { contains: 'malaria', mode: 'insensitive' } } },
        select: { resultValue: true },
      }),
      db.clinicalDocument.count({ where: { tenantId: t, type: 'REFERRAL', voidedAt: null, createdAt: range } }),
      db.visit.count({ where: { tenantId: t, kind: 'OPD', checkedInAt: range, status: { not: 'CANCELLED' }, referredFrom: { not: null } } }),
      immunizationTally(db, t, startDay, endDay),
      ancTally(db, t, startDay, endDay),
      fpTally(db, t, startDay, endDay),
    ]);

    // A visit is "new" if it is the patient's first ever visit at this facility.
    const patientIds = [...new Set(visits.map((v) => v.patientId))];
    const firsts = await db.visit.groupBy({
      by: ['patientId'],
      where: { tenantId: t, kind: 'OPD', patientId: { in: patientIds }, status: { not: 'CANCELLED' } },
      _min: { checkedInAt: true },
    });
    const firstVisit = new Map(firsts.map((f) => [f.patientId, f._min.checkedInAt!.getTime()]));

    const groups = [...AGE_GROUPS.map((g) => g.key), 'unknown'];
    const opd = Object.fromEntries(groups.map((g) => [g, { male: 0, female: 0 }])) as Record<string, { male: number; female: number }>;
    let newVisits = 0;
    const morbidity = new Map<string, { label: string; male: number; female: number }>();
    for (const v of visits) {
      const sexKey = v.patient.sex === 'MALE' ? 'male' : 'female';
      opd[ageGroup(ageAt(v.patient.dateOfBirth, v.checkedInAt))][sexKey]++;
      if (firstVisit.get(v.patientId) === v.checkedInAt.getTime()) newVisits++;
      for (const d of v.diagnoses) {
        const row = morbidity.get(d.icd11Code) ?? { label: d.label, male: 0, female: 0 };
        row[sexKey]++;
        morbidity.set(d.icd11Code, row);
      }
    }

    const positive = malaria.filter((m) => m.resultValue && !/^neg/i.test(m.resultValue));
    return {
      facility: tenant,
      period: {
        ecYear: year,
        ecMonth: month,
        label: `${ETHIOPIAN_MONTHS[month - 1]} ${year}`,
        labelAm: `${ETHIOPIAN_MONTHS_AM[month - 1]} ${year}`,
        startDay,
        endDay, // exclusive
      },
      opd: {
        total: visits.length,
        male: visits.filter((v) => v.patient.sex === 'MALE').length,
        female: visits.filter((v) => v.patient.sex === 'FEMALE').length,
        newVisits,
        repeatVisits: visits.length - newVisits,
        byAge: groups.map((g) => ({ ageGroup: g, ...opd[g] })),
        withoutDiagnosis: visits.filter((v) => v.diagnoses.length === 0).length,
        referralsOut,
        referralsIn,
      },
      morbidity: [...morbidity.entries()]
        .map(([code, r]) => ({ code, ...r, total: r.male + r.female }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      immunization,
      anc,
      familyPlanning,
      malaria: {
        tested: malaria.length,
        positive: positive.length,
        byResult: tally(malaria, (m) => m.resultValue ?? 'unknown').map(([result, count]) => ({ result, count })),
      },
    };
  }
}

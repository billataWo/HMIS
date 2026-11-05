import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ETHIOPIAN_MONTHS, ETHIOPIAN_MONTHS_AM, ethiopianMonthRange, toEthiopian } from '../common/ethiopian-calendar.js';
import { fromCents, toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { EXPIRY_WARNING_DAYS } from '../inventory/inventory.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RangeSchema = z.object({
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
});
const MonthSchema = z.object({
  ecYear: z.coerce.number().int().min(1990).max(2100).optional(),
  ecMonth: z.coerce.number().int().min(1).max(13).optional(),
});

/** Age bands used for the OPD tables; review against the Regional Health Bureau's current form. */
export const AGE_GROUPS = [
  { key: '<1', min: 0, max: 0 },
  { key: '1-4', min: 1, max: 4 },
  { key: '5-14', min: 5, max: 14 },
  { key: '15-29', min: 15, max: 29 },
  { key: '30-64', min: 30, max: 64 },
  { key: '65+', min: 65, max: 200 },
] as const;

export function ageAt(dob: Date | null, at: Date): number | null {
  if (!dob) return null;
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = at.getUTCMonth() < dob.getUTCMonth() || (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age--;
  return Math.max(0, age);
}

export function ageGroup(age: number | null) {
  if (age === null) return 'unknown';
  return AGE_GROUPS.find((g) => age >= g.min && age <= g.max)?.key ?? 'unknown';
}

/** Counts items by key, most frequent first. */
function tally<T>(items: T[], key: (t: T) => string, take = 10) {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, take);
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

    const [visits, newPatients, payments, invoices, outstanding, unbilled, diagnoses, labOrders, pharmacyCharges, dispensed, drugs, losses] =
      await Promise.all([
        db.visit.findMany({
          where: { tenantId: t, checkedInAt: range, status: { not: 'CANCELLED' } },
          select: { checkedInAt: true, calledAt: true, status: true, doctor: { select: { fullName: true } } },
        }),
        db.patient.count({ where: { tenantId: t, createdAt: range } }),
        db.payment.findMany({ where: { tenantId: t, receivedAt: range }, select: { amount: true, method: true, receivedAt: true } }),
        db.invoice.findMany({ where: { tenantId: t, createdAt: range, status: { not: 'VOID' } }, select: { total: true, discount: true } }),
        db.invoice.findMany({
          where: { tenantId: t, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
          select: { total: true, paid: true, payerType: true, payerName: true },
        }),
        db.charge.findMany({ where: { visit: { tenantId: t }, invoiceId: null, createdAt: range }, select: { unitPrice: true, quantity: true } }),
        db.diagnosis.findMany({
          where: { visit: { tenantId: t, checkedInAt: range, status: { not: 'CANCELLED' } } },
          select: { icd11Code: true, label: true },
        }),
        db.labOrder.findMany({
          where: { tenantId: t, orderedAt: range, status: { not: 'CANCELLED' } },
          select: { status: true, resultFlag: true, labTest: { select: { name: true } } },
        }),
        db.charge.findMany({ where: { visit: { tenantId: t }, source: 'PHARMACY', createdAt: range }, select: { unitPrice: true, quantity: true } }),
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

    const waits = visits.filter((v) => v.calledAt).map((v) => (v.calledAt!.getTime() - v.checkedInAt.getTime()) / 60000);
    const byMethod: Record<string, number> = {};
    for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + toCents(p.amount);
    const collected = payments.reduce((s, p) => s + toCents(p.amount), 0);

    const owed = outstanding.map((i) => ({ ...i, due: toCents(i.total) - toCents(i.paid) }));
    const receivables = new Map<string, number>();
    for (const i of owed.filter((x) => x.payerType !== 'SELF')) {
      const k = `${i.payerType === 'CREDIT' ? 'Credit' : 'Insurance'}: ${i.payerName ?? 'unnamed'}`;
      receivables.set(k, (receivables.get(k) ?? 0) + i.due);
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

    const visitsByDay = new Map<string, number>();
    for (const v of visits) visitsByDay.set(clinicDay(v.checkedInAt), (visitsByDay.get(clinicDay(v.checkedInAt)) ?? 0) + 1);
    const cashByDay = new Map<string, number>();
    for (const p of payments) cashByDay.set(clinicDay(p.receivedAt), (cashByDay.get(clinicDay(p.receivedAt)) ?? 0) + toCents(p.amount));

    return {
      from,
      to,
      patients: {
        visits: visits.length,
        completed: visits.filter((v) => v.status === 'COMPLETED').length,
        newPatients,
        avgWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
        byDoctor: tally(visits.filter((v) => v.doctor), (v) => v.doctor!.fullName).map(([name, count]) => ({ name, count })),
      },
      revenue: {
        collected: fromCents(collected),
        byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, fromCents(v)])),
        billed: fromCents(invoices.reduce((s, i) => s + toCents(i.total), 0)),
        discounts: fromCents(invoices.reduce((s, i) => s + toCents(i.discount), 0)),
        // Services delivered in the range that nobody has invoiced yet: the leakage indicator.
        unbilled: fromCents(unbilled.reduce((s, c) => s + toCents(c.unitPrice) * c.quantity, 0)),
        unbilledCount: unbilled.length,
        patientsOwe: fromCents(owed.filter((i) => i.payerType === 'SELF').reduce((s, i) => s + i.due, 0)),
        receivables: [...receivables.entries()].sort((a, b) => b[1] - a[1]).map(([payer, due]) => ({ payer, due: fromCents(due) })),
      },
      topDiagnoses: tally(diagnoses, (d) => d.icd11Code).map(([code, count]) => ({ code, label: labels.get(code) ?? code, count })),
      lab: {
        ordered: labOrders.length,
        verified: labOrders.filter((o) => o.status === 'VERIFIED').length,
        abnormal: labOrders.filter((o) => o.resultFlag === 'H' || o.resultFlag === 'L').length,
        topTests: tally(labOrders, (o) => o.labTest.name, 5).map(([name, count]) => ({ name, count })),
      },
      pharmacy: {
        sales: fromCents(pharmacyCharges.reduce((s, c) => s + toCents(c.unitPrice) * c.quantity, 0)),
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
      daily: days.map((day) => ({ day, visits: visitsByDay.get(day) ?? 0, collected: fromCents(cashByDay.get(day) ?? 0) })),
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

    const [tenant, visits, malaria] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: t }, select: { name: true, nameAm: true, address: true } }),
      db.visit.findMany({
        where: { tenantId: t, checkedInAt: range, status: { not: 'CANCELLED' } },
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
    ]);

    // A visit is "new" if it is the patient's first ever visit at this facility.
    const patientIds = [...new Set(visits.map((v) => v.patientId))];
    const firsts = await db.visit.groupBy({
      by: ['patientId'],
      where: { tenantId: t, patientId: { in: patientIds }, status: { not: 'CANCELLED' } },
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
      },
      morbidity: [...morbidity.entries()]
        .map(([code, r]) => ({ code, ...r, total: r.male + r.female }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      malaria: {
        tested: malaria.length,
        positive: positive.length,
        byResult: tally(malaria, (m) => m.resultValue ?? 'unknown').map(([result, count]) => ({ result, count })),
      },
    };
  }
}

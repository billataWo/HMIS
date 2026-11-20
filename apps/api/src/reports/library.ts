import type { AuthUser } from '../auth/auth.decorators.js';
import { patientDue, payerDue } from '../billing/billing.controller.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AGE_GROUPS, ageAt, ageGroup } from './age.js';

/**
 * The report library: standard, named reports with every row, for the record (accounting, the
 * MoH, audits, insurers, stock control), where the dashboard is the at-a-glance view. Each report
 * returns plain rows keyed by column; the web app owns the titles, column labels and formats
 * (lib/reports.ts), and the CSV is made from the same rows.
 */

type Db = PrismaService['client'];
export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export interface ReportQuery {
  from: string;
  to: string;
  method?: string;
  doctorId?: string;
  status?: string;
  days?: number;
}
interface Ctx {
  db: Db;
  t: string;
  me: AuthUser;
  q: ReportQuery;
  range: { gte: Date; lt: Date };
}
export interface ReportResult {
  rows: Row[];
  totals?: Row;
  /** More rows than a report returns: narrow the period. */
  truncated?: boolean;
  /** As of now (stock, money owed), not for the period. */
  asOfNow?: boolean;
}

/** The most rows a report returns (a year of a busy clinic's visits fits). */
export const ROW_CAP = 20_000;

const nameOf = (p: { firstName: string; fatherName: string; grandfather?: string | null }) => [p.firstName, p.fatherName, p.grandfather].filter(Boolean).join(' ');
const patientSelect = { mrn: true, firstName: true, fatherName: true, grandfather: true } as const;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const minutes = (from: Date | null, to: Date | null) => (from && to ? Math.round((to.getTime() - from.getTime()) / 60000) : null);
const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + toCents(r[key] ?? 0), 0);
const sumCount = (rows: Row[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
const capped = (rows: Row[]) => ({ rows: rows.slice(0, ROW_CAP), truncated: rows.length > ROW_CAP });

const REPORTS: Record<string, (c: Ctx) => Promise<ReportResult>> = {
  // ── Money ─────────────────────────────────────────────────────────────────────────────────────
  /** Every payment, refund and reversal received, with its receipt and cashier. */
  async payments({ db, t, q, range }) {
    const list = await db.payment.findMany({
      where: { tenantId: t, receivedAt: range, ...(q.method ? { method: q.method as 'CASH' } : {}), ...(q.status === 'REFUNDS' ? { OR: [{ amount: { lt: 0 } }, { reversalOfId: { not: null } }] } : {}) },
      orderBy: { receivedAt: 'asc' },
      take: ROW_CAP + 1,
      select: {
        receivedAt: true,
        method: true,
        reference: true,
        amount: true,
        byPayer: true,
        reversalOfId: true,
        note: true,
        cashier: { select: { fullName: true } },
        invoice: { select: { number: true, payerName: true, patient: { select: patientSelect } } },
      },
    });
    const rows: Row[] = list.map((p) => ({
      at: iso(p.receivedAt),
      invoice: p.invoice.number,
      mrn: p.invoice.patient.mrn,
      patient: nameOf(p.invoice.patient),
      kind: p.reversalOfId ? 'REVERSAL' : toCents(p.amount) < 0 ? 'REFUND' : p.byPayer ? 'PAYER' : 'PAYMENT',
      method: p.method,
      reference: p.reference ?? p.note ?? null,
      cashier: p.cashier.fullName,
      amount: fromCents(toCents(p.amount)),
    }));
    return { ...capped(rows), totals: { amount: fromCents(sum(rows, 'amount')) } };
  },

  /** What each service brought in: delivered, billed and not yet billed. */
  async 'revenue-by-service'({ db, t, range }) {
    const charges = await db.charge.findMany({
      where: { visit: { tenantId: t }, voidedAt: null, createdAt: range },
      select: { source: true, description: true, unitPrice: true, quantity: true, invoiceId: true },
    });
    const by = new Map<string, { source: string; service: string; quantity: number; amount: number; billed: number }>();
    for (const c of charges) {
      const k = `${c.source}|${c.description}`;
      const e = by.get(k) ?? { source: c.source, service: c.description, quantity: 0, amount: 0, billed: 0 };
      const cents = toCents(c.unitPrice) * c.quantity;
      e.quantity += c.quantity;
      e.amount += cents;
      if (c.invoiceId) e.billed += cents;
      by.set(k, e);
    }
    const rows: Row[] = [...by.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((e) => ({ source: e.source, service: e.service, quantity: e.quantity, amount: fromCents(e.amount), billed: fromCents(e.billed), notBilled: fromCents(e.amount - e.billed) }));
    return { rows, totals: { quantity: sumCount(rows, 'quantity'), amount: fromCents(sum(rows, 'amount')), billed: fromCents(sum(rows, 'billed')), notBilled: fromCents(sum(rows, 'notBilled')) } };
  },

  /** Every invoice raised, with what was paid and what is left. */
  async invoices({ db, t, q, range }) {
    const list = await db.invoice.findMany({
      where: { tenantId: t, createdAt: range, ...(q.status ? { status: q.status as 'OPEN' } : {}) },
      orderBy: { createdAt: 'asc' },
      take: ROW_CAP + 1,
      select: { number: true, createdAt: true, status: true, payerType: true, payerName: true, total: true, discount: true, paid: true, patient: { select: patientSelect } },
    });
    const rows: Row[] = list.map((i) => ({
      at: iso(i.createdAt),
      invoice: i.number,
      mrn: i.patient.mrn,
      patient: nameOf(i.patient),
      payer: i.payerType === 'SELF' ? null : i.payerName,
      status: i.status,
      total: fromCents(toCents(i.total)),
      discount: fromCents(toCents(i.discount)),
      paid: fromCents(toCents(i.paid)),
      balance: fromCents(i.status === 'VOID' ? 0 : toCents(i.total) - toCents(i.paid)),
    }));
    const live = rows.filter((r) => r.status !== 'VOID');
    return {
      ...capped(rows),
      totals: { total: fromCents(sum(live, 'total')), discount: fromCents(sum(live, 'discount')), paid: fromCents(sum(live, 'paid')), balance: fromCents(sum(live, 'balance')) },
    };
  },

  /** Discounts and exemptions given, why, and by whom: what an auditor asks for first. */
  async discounts({ db, t, range }) {
    const list = await db.invoice.findMany({
      where: { tenantId: t, createdAt: range, status: { not: 'VOID' }, discount: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
      take: ROW_CAP + 1,
      select: {
        number: true,
        createdAt: true,
        subtotal: true,
        discount: true,
        discountCategory: true,
        discountReason: true,
        createdBy: { select: { fullName: true } },
        patient: { select: patientSelect },
      },
    });
    const rows: Row[] = list.map((i) => ({
      at: iso(i.createdAt),
      invoice: i.number,
      mrn: i.patient.mrn,
      patient: nameOf(i.patient),
      category: i.discountCategory ?? 'UNCATEGORISED',
      reason: i.discountReason,
      subtotal: fromCents(toCents(i.subtotal)),
      discount: fromCents(toCents(i.discount)),
      by: i.createdBy.fullName,
    }));
    return { ...capped(rows), totals: { subtotal: fromCents(sum(rows, 'subtotal')), discount: fromCents(sum(rows, 'discount')) } };
  },

  /** Who owes the clinic, today: each patient and each credit company or insurer, by age of debt. */
  async debtors({ db, t }) {
    const open = await db.invoice.findMany({
      where: { tenantId: t, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
      select: { total: true, paid: true, payerType: true, payerName: true, patientShare: true, patientPaid: true, createdAt: true, patientId: true, patient: { select: { ...patientSelect, phone: true } } },
    });
    type Debt = { debtor: string; kind: string; mrn: string | null; phone: string | null; invoices: number; oldest: Date; buckets: number[] };
    const debts = new Map<string, Debt>();
    const add = (key: string, base: Omit<Debt, 'invoices' | 'oldest' | 'buckets'>, at: Date, cents: number) => {
      if (cents <= 0) return;
      const d = debts.get(key) ?? { ...base, invoices: 0, oldest: at, buckets: [0, 0, 0, 0] };
      const days = (Date.now() - at.getTime()) / 86_400_000;
      d.invoices++;
      if (at < d.oldest) d.oldest = at;
      d.buckets[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3] += cents;
      debts.set(key, d);
    };
    for (const i of open) {
      add(`p:${i.patientId}`, { debtor: nameOf(i.patient), kind: 'PATIENT', mrn: i.patient.mrn, phone: i.patient.phone }, i.createdAt, patientDue(i));
      if (i.payerType !== 'SELF') add(`y:${i.payerName}`, { debtor: i.payerName ?? 'unnamed', kind: i.payerType, mrn: null, phone: null }, i.createdAt, payerDue(i));
    }
    const rows: Row[] = [...debts.values()]
      .map((d) => ({ total: d.buckets.reduce((a, b) => a + b, 0), d }))
      .sort((a, b) => b.total - a.total)
      .map(({ total, d }) => ({
        debtor: d.debtor,
        kind: d.kind,
        mrn: d.mrn,
        phone: d.phone,
        invoices: d.invoices,
        oldest: iso(d.oldest),
        d0: fromCents(d.buckets[0]),
        d31: fromCents(d.buckets[1]),
        d61: fromCents(d.buckets[2]),
        d90: fromCents(d.buckets[3]),
        owed: fromCents(total),
      }));
    const totals: Row = { invoices: sumCount(rows, 'invoices') };
    for (const k of ['d0', 'd31', 'd61', 'd90', 'owed']) totals[k] = fromCents(sum(rows, k));
    return { rows, totals, asOfNow: true };
  },

  // ── Clinical ──────────────────────────────────────────────────────────────────────────────────
  /** The OPD register: every visit, new or repeat, with the doctor and the main diagnosis. */
  async 'opd-register'({ db, t, q, range }) {
    const visits = await db.visit.findMany({
      where: { tenantId: t, kind: 'OPD', checkedInAt: range, status: { not: 'CANCELLED' }, ...(q.doctorId ? { doctorId: q.doctorId } : {}) },
      orderBy: { checkedInAt: 'asc' },
      take: ROW_CAP + 1,
      select: {
        patientId: true,
        checkedInAt: true,
        queueNumber: true,
        status: true,
        referredFrom: true,
        doctor: { select: { fullName: true } },
        patient: { select: { ...patientSelect, sex: true, dateOfBirth: true } },
        diagnoses: { orderBy: { isPrimary: 'desc' }, take: 1, select: { icd11Code: true, label: true } },
      },
    });
    const firsts = await db.visit.groupBy({
      by: ['patientId'],
      where: { tenantId: t, kind: 'OPD', status: { not: 'CANCELLED' }, patientId: { in: [...new Set(visits.map((v) => v.patientId))] } },
      _min: { checkedInAt: true },
    });
    const first = new Map(firsts.map((f) => [f.patientId, f._min.checkedInAt?.getTime()]));
    const rows: Row[] = visits.map((v) => ({
      at: iso(v.checkedInAt),
      queue: v.queueNumber,
      mrn: v.patient.mrn,
      patient: nameOf(v.patient),
      sex: v.patient.sex,
      age: ageAt(v.patient.dateOfBirth, v.checkedInAt),
      visitType: first.get(v.patientId) === v.checkedInAt.getTime() ? 'NEW' : 'REPEAT',
      referredFrom: v.referredFrom,
      doctor: v.doctor?.fullName ?? null,
      diagnosis: v.diagnoses[0] ? `${v.diagnoses[0].icd11Code} ${v.diagnoses[0].label}` : null,
      status: v.status,
    }));
    return capped(rows);
  },

  /** Cases by diagnosis (ICD-11), by sex and age group: every diagnosis recorded on a visit. */
  async morbidity({ db, t, range }) {
    const list = await db.diagnosis.findMany({
      where: { visit: { tenantId: t, checkedInAt: range, status: { not: 'CANCELLED' } } },
      select: { icd11Code: true, label: true, visit: { select: { checkedInAt: true, patient: { select: { sex: true, dateOfBirth: true } } } } },
    });
    const groups = [...AGE_GROUPS.map((g) => g.key), 'unknown'];
    const by = new Map<string, Row>();
    for (const d of list) {
      const r = by.get(d.icd11Code) ?? { code: d.icd11Code, diagnosis: d.label, male: 0, female: 0, ...Object.fromEntries(groups.map((g) => [`age:${g}`, 0])), total: 0 };
      r[d.visit.patient.sex === 'MALE' ? 'male' : 'female'] = Number(r[d.visit.patient.sex === 'MALE' ? 'male' : 'female']) + 1;
      const g = `age:${ageGroup(ageAt(d.visit.patient.dateOfBirth, d.visit.checkedInAt))}`;
      r[g] = Number(r[g]) + 1;
      r.total = Number(r.total) + 1;
      by.set(d.icd11Code, r);
    }
    const rows = [...by.values()].sort((a, b) => Number(b.total) - Number(a.total));
    const totals: Row = {};
    for (const k of ['male', 'female', ...groups.map((g) => `age:${g}`), 'total']) totals[k] = sumCount(rows, k);
    return { rows, totals };
  },

  /** The lab register: every test ordered, its result and flag, who released it and how fast. */
  async 'lab-register'({ db, t, q, range }) {
    const list = await db.labOrder.findMany({
      where: { tenantId: t, orderedAt: range, ...(q.status ? { status: q.status as 'ORDERED' } : { status: { not: 'CANCELLED' } }) },
      orderBy: { orderedAt: 'asc' },
      take: ROW_CAP + 1,
      select: {
        orderedAt: true,
        urgent: true,
        status: true,
        resultValue: true,
        resultFlag: true,
        sampleCollectedAt: true,
        verifiedAt: true,
        sentTo: true,
        labTest: { select: { name: true, unit: true } },
        verifiedBy: { select: { fullName: true } },
        visit: { select: { patient: { select: patientSelect } } },
      },
    });
    const rows: Row[] = list.map((o) => ({
      at: iso(o.orderedAt),
      mrn: o.visit.patient.mrn,
      patient: nameOf(o.visit.patient),
      test: o.labTest.name,
      urgent: o.urgent ? 'URGENT' : null,
      result: o.resultValue ? `${o.resultValue}${o.labTest.unit ? ` ${o.labTest.unit}` : ''}` : null,
      flag: o.resultFlag && o.resultFlag !== 'N' ? o.resultFlag : null,
      status: o.status,
      sentTo: o.sentTo,
      verifiedBy: o.verifiedBy?.fullName ?? null,
      tat: minutes(o.sampleCollectedAt, o.verifiedAt),
    }));
    return capped(rows);
  },

  /** Patients referred out, where, how urgently, and whether they got there. */
  async referrals({ db, t, range }) {
    const list = await db.clinicalDocument.findMany({
      where: { tenantId: t, type: 'REFERRAL', voidedAt: null, createdAt: range },
      orderBy: { createdAt: 'asc' },
      take: ROW_CAP + 1,
      select: { createdAt: true, data: true, visit: { select: { patient: { select: patientSelect } } }, followUps: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } },
    });
    const rows: Row[] = list.map((d) => {
      const data = (d.data ?? {}) as { to?: string; urgency?: string; reason?: string };
      return {
        at: iso(d.createdAt),
        mrn: d.visit.patient.mrn,
        patient: nameOf(d.visit.patient),
        to: data.to ?? null,
        urgency: data.urgency ?? 'ROUTINE',
        reason: data.reason ?? null,
        status: d.followUps[0]?.status ?? 'SENT',
      };
    });
    return capped(rows);
  },

  // ── Pharmacy and stock ────────────────────────────────────────────────────────────────────────
  /** Every drug on the list today: what is on the shelf, what it cost, and what to reorder. */
  async 'stock-on-hand'({ db, t }) {
    const today = dayRange(clinicDay()).start;
    const drugs = await db.drug.findMany({
      where: { tenantId: t, active: true },
      orderBy: { genericName: 'asc' },
      select: { genericName: true, brandName: true, form: true, strength: true, unit: true, reorderLevel: true, batches: { where: { quantity: { gt: 0 } }, select: { quantity: true, costPrice: true, expiryDate: true } } },
    });
    const rows: Row[] = drugs.map((d) => {
      const usable = d.batches.filter((b) => b.expiryDate >= today);
      const onHand = usable.reduce((s, b) => s + b.quantity, 0);
      const expired = d.batches.filter((b) => b.expiryDate < today).reduce((s, b) => s + b.quantity, 0);
      const nearest = usable.map((b) => b.expiryDate).sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        drug: [d.genericName, d.strength, d.brandName ? `(${d.brandName})` : null].filter(Boolean).join(' '),
        form: d.form,
        unit: d.unit,
        onHand,
        reorderLevel: d.reorderLevel,
        status: onHand === 0 ? 'OUT' : d.reorderLevel > 0 && onHand <= d.reorderLevel ? 'LOW' : 'OK',
        nearestExpiry: iso(nearest),
        expired: expired || null,
        value: fromCents(usable.reduce((s, b) => s + b.quantity * toCents(b.costPrice), 0)),
      };
    });
    return { rows, totals: { value: fromCents(sum(rows, 'value')) }, asOfNow: true };
  },

  /** Batches on the shelf that have expired or will within the chosen number of days. */
  async expiry({ db, t, q }) {
    const days = q.days ?? 90;
    const today = dayRange(clinicDay()).start;
    const batches = await db.stockBatch.findMany({
      where: { quantity: { gt: 0 }, drug: { tenantId: t }, expiryDate: { lt: new Date(today.getTime() + days * 86_400_000) } },
      orderBy: { expiryDate: 'asc' },
      select: { batchNo: true, expiryDate: true, quantity: true, costPrice: true, drug: { select: { genericName: true, strength: true, unit: true } }, store: { select: { name: true } } },
    });
    const rows: Row[] = batches.map((b) => ({
      drug: [b.drug.genericName, b.drug.strength].filter(Boolean).join(' '),
      batch: b.batchNo,
      store: b.store?.name ?? null,
      expiry: iso(b.expiryDate),
      daysLeft: Math.floor((b.expiryDate.getTime() - today.getTime()) / 86_400_000),
      quantity: b.quantity,
      unit: b.drug.unit,
      value: fromCents(b.quantity * toCents(b.costPrice)),
    }));
    return { rows, totals: { quantity: sumCount(rows, 'quantity'), value: fromCents(sum(rows, 'value')) }, asOfNow: true };
  },

  /** What the pharmacy gave out, per drug, less what patients brought back. */
  async dispensing({ db, t, range }) {
    const moves = await db.stockMovement.findMany({
      where: { createdAt: range, type: { in: ['DISPENSE', 'RETURN'] }, batch: { drug: { tenantId: t } } },
      select: { quantity: true, batch: { select: { costPrice: true, drug: { select: { id: true, genericName: true, strength: true, unit: true, sellPrice: true } } } } },
    });
    const by = new Map<string, { drug: string; unit: string; units: number; cost: number; sell: number }>();
    for (const m of moves) {
      const d = m.batch.drug;
      const e = by.get(d.id) ?? { drug: [d.genericName, d.strength].filter(Boolean).join(' '), unit: d.unit, units: 0, cost: 0, sell: 0 };
      // Dispensing takes stock off (negative); a return puts it back (positive).
      e.units -= m.quantity;
      e.cost -= m.quantity * toCents(m.batch.costPrice);
      e.sell -= m.quantity * toCents(d.sellPrice);
      by.set(d.id, e);
    }
    const rows: Row[] = [...by.values()]
      .filter((e) => e.units !== 0)
      .sort((a, b) => b.units - a.units)
      .map((e) => ({ drug: e.drug, unit: e.unit, units: e.units, cost: fromCents(e.cost), value: fromCents(e.sell), margin: fromCents(e.sell - e.cost) }));
    return { rows, totals: { units: sumCount(rows, 'units'), cost: fromCents(sum(rows, 'cost')), value: fromCents(sum(rows, 'value')), margin: fromCents(sum(rows, 'margin')) } };
  },

  /** Stock written off: expired, damaged, lost or corrected down, with who did it and why. */
  async 'stock-losses'({ db, t, range }) {
    const moves = await db.stockMovement.findMany({
      where: { createdAt: range, batch: { drug: { tenantId: t } }, OR: [{ type: 'EXPIRED' }, { type: 'ADJUSTMENT', quantity: { lt: 0 } }] },
      orderBy: { createdAt: 'asc' },
      take: ROW_CAP + 1,
      select: { createdAt: true, type: true, quantity: true, reason: true, userId: true, batch: { select: { batchNo: true, costPrice: true, drug: { select: { genericName: true, strength: true, unit: true } } } } },
    });
    const users = new Map(
      (await db.user.findMany({ where: { tenantId: t, id: { in: [...new Set(moves.map((m) => m.userId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
    );
    const rows: Row[] = moves.map((m) => ({
      at: iso(m.createdAt),
      drug: [m.batch.drug.genericName, m.batch.drug.strength].filter(Boolean).join(' '),
      batch: m.batch.batchNo,
      type: m.type,
      reason: m.reason,
      quantity: -m.quantity,
      unit: m.batch.drug.unit,
      value: fromCents(-m.quantity * toCents(m.batch.costPrice)),
      by: m.userId ? (users.get(m.userId) ?? null) : null,
    }));
    return { ...capped(rows), totals: { quantity: sumCount(rows, 'quantity'), value: fromCents(sum(rows, 'value')) } };
  },

  // ── Operations ────────────────────────────────────────────────────────────────────────────────
  /** What each member of staff did in the period. */
  async 'staff-activity'({ db, t, range }) {
    const [users, seen, collected, verified, payments, dispensed] = await Promise.all([
      db.user.findMany({ where: { tenantId: t }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, role: true, active: true } }),
      db.visit.groupBy({ by: ['doctorId'], where: { tenantId: t, kind: 'OPD', calledAt: range, status: { not: 'CANCELLED' } }, _count: { _all: true } }),
      db.labOrder.groupBy({ by: ['collectedById'], where: { tenantId: t, sampleCollectedAt: range }, _count: { _all: true } }),
      db.labOrder.groupBy({ by: ['verifiedById'], where: { tenantId: t, verifiedAt: range }, _count: { _all: true } }),
      db.payment.groupBy({ by: ['cashierId'], where: { tenantId: t, receivedAt: range }, _count: { _all: true }, _sum: { amount: true } }),
      db.stockMovement.groupBy({ by: ['userId'], where: { type: 'DISPENSE', createdAt: range, batch: { drug: { tenantId: t } } }, _count: { _all: true } }),
    ]);
    const count = <K extends string>(xs: ({ _count: { _all: number } } & Record<K, string | null>)[], key: K, id: string) => xs.find((x) => x[key] === id)?._count._all ?? 0;
    const rows: Row[] = users
      .map((u) => {
        const pay = payments.find((p) => p.cashierId === u.id);
        return {
          name: u.fullName,
          role: u.role,
          active: u.active ? null : 'INACTIVE',
          patientsSeen: count(seen, 'doctorId', u.id),
          samplesTaken: count(collected, 'collectedById', u.id),
          resultsVerified: count(verified, 'verifiedById', u.id),
          itemsDispensed: count(dispensed, 'userId', u.id),
          paymentsTaken: pay?._count._all ?? 0,
          collected: fromCents(toCents(pay?._sum.amount ?? 0)),
        };
      })
      .filter((r) => r.active === null || r.patientsSeen + r.samplesTaken + r.resultsVerified + r.itemsDispensed + r.paymentsTaken > 0);
    const totals: Row = { collected: fromCents(sum(rows, 'collected')) };
    for (const k of ['patientsSeen', 'samplesTaken', 'resultsVerified', 'itemsDispensed', 'paymentsTaken']) totals[k] = sumCount(rows, k);
    return { rows, totals };
  },

  /** Appointments booked for the period, and whether the patient came. */
  async appointments({ db, t, q, range }) {
    const list = await db.appointment.findMany({
      where: { tenantId: t, scheduledAt: range, ...(q.status ? { status: q.status as 'BOOKED' } : {}), ...(q.doctorId ? { doctorId: q.doctorId } : {}) },
      orderBy: { scheduledAt: 'asc' },
      take: ROW_CAP + 1,
      select: { scheduledAt: true, status: true, reason: true, doctor: { select: { fullName: true } }, patient: { select: { ...patientSelect, phone: true } } },
    });
    const rows: Row[] = list.map((a) => ({
      at: iso(a.scheduledAt),
      mrn: a.patient.mrn,
      patient: nameOf(a.patient),
      phone: a.patient.phone,
      doctor: a.doctor?.fullName ?? null,
      reason: a.reason,
      status: a.status,
    }));
    return capped(rows);
  },

  /** Visits cancelled and why: patients who left without being seen are the warning sign. */
  async 'cancelled-visits'({ db, t, range }) {
    const list = await db.visit.findMany({
      where: { tenantId: t, kind: 'OPD', checkedInAt: range, status: 'CANCELLED' },
      orderBy: { checkedInAt: 'asc' },
      take: ROW_CAP + 1,
      select: { checkedInAt: true, queueNumber: true, cancelReason: true, patient: { select: { ...patientSelect, phone: true } } },
    });
    const rows: Row[] = list.map((v) => ({
      at: iso(v.checkedInAt),
      queue: v.queueNumber,
      mrn: v.patient.mrn,
      patient: nameOf(v.patient),
      phone: v.patient.phone,
      reason: v.cancelReason ?? 'NOT_GIVEN',
    }));
    return capped(rows);
  },
};

export const REPORT_KEYS = Object.keys(REPORTS);

export function runReport(key: string, ctx: Omit<Ctx, 'range'>): Promise<ReportResult> {
  const range = { gte: dayRange(ctx.q.from).start, lt: dayRange(ctx.q.to).end };
  return REPORTS[key]({ ...ctx, range });
}

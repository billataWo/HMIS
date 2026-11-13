import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { LabOrderStatus, Prisma, Role } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { isSettled, prepaymentRequired, settlementSelect } from '../common/settlement.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import { type BandRange, type BaseRange, flagValue, isCritical, type Patient, pickRange, rangeText } from './ranges.js';

const OrderSchema = z.object({
  labTestIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one test')
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'Each test may appear only once'),
  /** Needed now (STAT): first on the bench, with the clinic's shorter target. */
  urgent: z.boolean().optional(),
});
/** Tests for someone who did not see a doctor here: a request from outside, or their own. */
const WalkInSchema = z.object({
  patientId: z.uuid(), // results belong on a named patient's record
  labTestIds: OrderSchema.shape.labTestIds,
  urgent: OrderSchema.shape.urgent,
  requestedBy: z
    .string()
    .trim()
    .max(200)
    .transform((s) => s || undefined)
    .optional(),
});
const CollectSchema = z.object({ sampleId: z.string().trim().max(50).optional() });
const resultFields = {
  value: z.string().trim().max(2000).optional(), // single-value tests
  values: z.array(z.object({ componentId: z.uuid(), value: z.string().trim().max(200) })).max(60).optional(), // panels
  note: z.string().trim().max(1000).optional(),
};
const hasResult = (b: { value?: string; values?: { value: string }[] }) => (b.value && b.value.length > 0) || b.values?.some((v) => v.value);
const ResultSchema = z.object(resultFields).refine(hasResult, { message: 'Enter the result', path: ['value'] });
/** Who was told of a critical result, how and when ("Dr. Dawit, by phone"). */
const notified = z
  .string()
  .trim()
  .max(200)
  .transform((s) => s || undefined)
  .optional();
const VerifySchema = z.object({ notified });
const AmendSchema = z
  .object({ ...resultFields, notified, reason: z.string().trim().min(5, 'Say what was wrong with the released result').max(500) })
  .refine(hasResult, { message: 'Enter the corrected result', path: ['value'] });

/** Why a sample can't be used; the lab collects a new one. */
export const REJECT_REASONS = {
  HAEMOLYSED: 'Haemolysed',
  CLOTTED: 'Clotted',
  INSUFFICIENT: 'Too little sample',
  WRONG_CONTAINER: 'Wrong tube or container',
  LABEL: 'Unlabelled or wrongly labelled',
  CONTAMINATED: 'Contaminated',
  DELAYED: 'Too old when it reached the lab',
  OTHER: 'Other',
} as const;
const RejectSchema = z
  .object({
    reason: z.enum(Object.keys(REJECT_REASONS) as [keyof typeof REJECT_REASONS, ...(keyof typeof REJECT_REASONS)[]]),
    note: z
      .string()
      .trim()
      .max(300)
      .transform((s) => s || undefined)
      .optional(),
  })
  .refine((b) => b.reason !== 'OTHER' || !!b.note, { message: 'Say what was wrong with the sample', path: ['note'] });

const LAB: Role[] = ['ADMIN', 'LAB_TECH'];
const OPEN: LabOrderStatus[] = ['ORDERED', 'SAMPLE_COLLECTED', 'RESULTED'];

/**
 * How long a test should take, sample taken to result released (minutes): the test's own target,
 * or for an urgent test the clinic's urgent target (or the test's, if that is shorter). Null when
 * the test has no target and isn't urgent.
 */
export function targetMinutes(urgent: boolean, tatMinutes: number | null, urgentMinutes: number) {
  if (urgent) return tatMinutes === null ? urgentMinutes : Math.min(tatMinutes, urgentMinutes);
  return tatMinutes;
}

const rangeSelect = { sex: true, ageFromDays: true, ageToDays: true, refLow: true, refHigh: true, critLow: true, critHigh: true } satisfies Prisma.LabRangeSelect;
const orderInclude = {
  labTest: {
    select: {
      id: true,
      name: true,
      loincCode: true,
      unit: true,
      refLow: true,
      refHigh: true,
      critLow: true,
      critHigh: true,
      resultOptions: true,
      tatMinutes: true,
      ranges: { select: rangeSelect },
      components: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, unit: true, refLow: true, refHigh: true, critLow: true, critHigh: true, resultOptions: true, ranges: { select: rangeSelect } },
      },
    },
  },
  values: { select: { componentId: true, value: true, flag: true, rangeText: true } },
  orderedBy: { select: { id: true, fullName: true } },
  collectedBy: { select: { fullName: true } },
  resultedBy: { select: { fullName: true } },
  verifiedBy: { select: { fullName: true } },
  amendments: { orderBy: { createdAt: 'asc' }, select: { id: true, previousValue: true, previousFlag: true, reason: true, createdAt: true } },
} satisfies Prisma.LabOrderInclude;

/** Flags a numeric result against a plain reference range: L (low), H (high) or N (normal). */
export function flagResult(value: number, low: number | null, high: number | null) {
  return flagValue(value, { refLow: low, refHigh: high, critLow: null, critHigh: null, who: null });
}

type Checkable = BaseRange & { name: string; resultOptions: string[]; ranges: BandRange[] };

/**
 * Validates one result against its answers or range. Numeric results get a flag (LL, L, N, H,
 * HH; double letters are critical) and the range they were judged by, as printed: the range for
 * this patient's sex and age where the test has one.
 */
function checkValue(c: Checkable, value: string, patient: Patient | null, at: Date): { flag: string | null; rangeText: string | null } {
  if (c.resultOptions.length) {
    if (!c.resultOptions.includes(value)) throw new ConflictException(`${c.name}: choose one of ${c.resultOptions.join(', ')}`);
    return { flag: null, rangeText: null };
  }
  const r = pickRange(c, c.ranges, patient, at);
  if (r.refLow === null && r.refHigh === null && r.critLow === null && r.critHigh === null) return { flag: null, rangeText: null };
  const v = Number(value.replace(',', '.'));
  if (!Number.isFinite(v)) throw new ConflictException(`${c.name} needs a number${c.unit ? ` in ${c.unit}` : ''}`);
  return { flag: flagValue(v, r), rangeText: rangeText(r, c.unit) };
}

/** The worst flag of a panel, for the one-line summary: critical, then abnormal, then normal. */
function worstFlag(flags: (string | null)[]) {
  for (const f of ['HH', 'LL', 'H', 'L', 'N']) if (flags.includes(f)) return f;
  return null;
}

/** Clinicians only see a value once the lab has verified it. */
function forViewer<T extends { status: LabOrderStatus; resultValue: string | null; resultFlag: string | null; resultNote: string | null; values: unknown[] }>(
  order: T,
  role: Role,
) {
  if (LAB.includes(role) || order.status === 'VERIFIED') return order;
  return { ...order, resultValue: null, resultFlag: null, resultNote: null, values: [] };
}

type Order = Prisma.LabOrderGetPayload<{ include: typeof orderInclude }>;

@Controller()
export class LabController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async order(me: AuthUser, id: string, tx: Pick<Prisma.TransactionClient, 'labOrder'> = this.prisma.client) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Lab order not found');
    const order = await tx.labOrder.findFirst({ where: { id, tenantId: me.tenantId }, include: orderInclude });
    if (!order) throw new NotFoundException('Lab order not found');
    return order;
  }

  @Get('lab/tests')
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH', 'RECEPTIONIST') // the front desk takes lab-only requests
  tests(@CurrentUser() me: AuthUser) {
    return this.prisma.client.labTest.findMany({ where: { tenantId: me.tenantId, active: true }, orderBy: { name: 'asc' } });
  }

  @Get('visits/:id/lab-orders')
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH')
  async forVisit(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const orders = await this.prisma.client.labOrder.findMany({
      where: { visitId: id, tenantId: me.tenantId },
      orderBy: [{ orderedAt: 'asc' }, { id: 'asc' }],
      include: orderInclude,
    });
    return orders.map((o) => forViewer(o, me.role));
  }

  @Post('visits/:id/lab-orders')
  @Roles('DOCTOR')
  async create(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(OrderSchema)) { labTestIds, urgent = false }: z.infer<typeof OrderSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    return this.prisma.client.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id, tenantId: me.tenantId } });
      if (!visit) throw new NotFoundException('Visit not found');
      if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') throw new ConflictException('This visit is closed');
      if (visit.kind === 'WALK_IN') throw new ConflictException('This is a pharmacy counter sale, not a consultation');
      if (visit.kind === 'LAB') throw new ConflictException('This is a lab-only visit: add its tests at the lab');
      if (visit.status === 'WAITING') throw new ConflictException('Call the patient in before ordering tests');

      const tests = await tx.labTest.findMany({ where: { id: { in: labTestIds }, tenantId: me.tenantId, active: true } });
      if (tests.length !== labTestIds.length) throw new NotFoundException('One or more tests were not found');
      const dup = await tx.labOrder.findFirst({
        where: { visitId: id, labTestId: { in: labTestIds }, status: { in: OPEN } },
        include: { labTest: { select: { name: true } } },
      });
      if (dup) throw new ConflictException(`${dup.labTest.name} is already ordered for this visit`);

      // In the order the doctor picked them (findMany returns rows in no particular order). Each
      // order gets its own millisecond, so every list sorted by orderedAt keeps that order.
      const byId = new Map(tests.map((t) => [t.id, t]));
      const now = Date.now();
      const created: string[] = [];
      for (const [i, testId] of labTestIds.entries()) {
        const t = byId.get(testId)!;
        const order = await tx.labOrder.create({
          data: { tenantId: me.tenantId, visitId: id, labTestId: t.id, orderedById: me.sub, orderedAt: new Date(now + i), urgent },
        });
        // Free tests (e.g. programme-funded HIV testing) create no charge, so nobody is sent to the cashier.
        if (Number(t.price) > 0) {
          await tx.charge.create({ data: { visitId: id, source: 'LAB', sourceId: order.id, description: t.name, unitPrice: t.price } });
        }
        created.push(order.id);
      }
      await this.audit.log(me, 'lab.order', 'Visit', id, { tests: tests.map((t) => t.name), ...(urgent && { urgent }) }, tx);
      const orders = await tx.labOrder.findMany({ where: { id: { in: created } }, include: orderInclude });
      return created.map((oid) => orders.find((o) => o.id === oid)!);
    });
  }

  @Post('lab-orders/:id/cancel')
  @Roles('DOCTOR')
  async cancel(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const order = await this.order(me, id, tx);
      if (order.status !== 'ORDERED') throw new ConflictException('Only tests whose sample has not been taken can be cancelled');
      const invoiced = await tx.charge.count({ where: { source: 'LAB', sourceId: id, invoiceId: { not: null }, voidedAt: null } });
      if (invoiced) throw new ConflictException('This test is already on an invoice; an admin removes it there (refunding it if paid), which also cancels it');
      await tx.charge.deleteMany({ where: { source: 'LAB', sourceId: id, invoiceId: null } });
      const updated = await tx.labOrder.update({ where: { id }, data: { status: 'CANCELLED' }, include: orderInclude });
      await this.audit.log(me, 'lab.cancel', 'LabOrder', id, undefined, tx);
      return updated;
    });
  }

  /**
   * A test needed now, after it was ordered (the patient got worse, or the lab sees it should be):
   * it moves to the top of the bench with the urgent target.
   */
  @Post('lab-orders/:id/urgent')
  @Roles('ADMIN', 'DOCTOR', 'LAB_TECH')
  async markUrgent(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const order = await this.order(me, id);
    if (!OPEN.includes(order.status)) throw new ConflictException('This test is already finished');
    if (order.urgent) return forViewer(order, me.role);
    const updated = await this.prisma.client.labOrder.update({ where: { id }, data: { urgent: true }, include: orderInclude });
    await this.audit.log(me, 'lab.urgent', 'LabOrder', id);
    return forViewer(updated, me.role);
  }

  /**
   * Open lab work, urgent first then oldest, with whether each test is paid and its turnaround
   * target (minutes from the sample); plus today's verified results.
   */
  @Get('lab/worklist')
  @Roles(...LAB)
  async worklist(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const include = { ...orderInclude, visit: { select: { id: true, queueNumber: true, kind: true, patient: { select: queuePatientSelect } } } };
    const [open, verifiedToday, prepayment, tenant] = await Promise.all([
      db.labOrder.findMany({ where: { tenantId: me.tenantId, status: { in: OPEN } }, orderBy: [{ urgent: 'desc' }, { orderedAt: 'asc' }, { id: 'asc' }], include }),
      db.labOrder.findMany({
        where: { tenantId: me.tenantId, status: 'VERIFIED', verifiedAt: { gte: dayRange(clinicDay()).start } },
        orderBy: { verifiedAt: 'desc' },
        include,
      }),
      prepaymentRequired(db, me.tenantId),
      db.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { labUrgentMinutes: true } }),
    ]);
    const target = (o: { urgent: boolean; labTest: { tatMinutes: number | null } }) => ({
      targetMinutes: targetMinutes(o.urgent, o.labTest.tatMinutes, tenant.labUrgentMinutes),
    });
    const charges = await db.charge.findMany({
      where: { source: 'LAB', sourceId: { in: open.map((o) => o.id) } },
      select: { sourceId: true, ...settlementSelect },
    });
    // An order is paid when it has no unsettled charge (free tests have no charge at all).
    const unpaid = new Set(charges.filter((c) => !isSettled(c)).map((c) => c.sourceId));
    return {
      prepayment,
      open: open.map((o) => ({ ...o, paid: !unpaid.has(o.id), ...target(o) })),
      verifiedToday: verifiedToday.map((o) => ({ ...o, ...target(o) })),
    };
  }

  @Post('lab-orders/:id/collect')
  @Roles(...LAB)
  async collect(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(CollectSchema)) body: z.infer<typeof CollectSchema>) {
    return this.prisma.client.$transaction(async (tx) => {
      const order = await this.order(me, id, tx);
      if (order.status !== 'ORDERED') throw new ConflictException('The sample for this test has already been taken');
      if (await prepaymentRequired(tx, me.tenantId)) {
        const charges = await tx.charge.findMany({ where: { source: 'LAB', sourceId: id }, select: settlementSelect });
        if (!charges.every(isSettled)) {
          throw new ConflictException(`${order.labTest.name} has not been paid for yet; send the patient to the cashier`);
        }
      }
      const updated = await tx.labOrder.update({
        where: { id },
        data: {
          status: 'SAMPLE_COLLECTED',
          // A new sample after a rejection gets its own number, so the two are never confused.
          sampleId: body.sampleId || `L-${id.slice(0, 8).toUpperCase()}${order.rejections ? `-${order.rejections + 1}` : ''}`,
          sampleCollectedAt: new Date(),
          collectedById: me.sub,
          rejectReason: null,
        },
        include: orderInclude,
      });
      await this.audit.log(me, 'lab.collect', 'LabOrder', id, { sampleId: updated.sampleId }, tx);
      return updated;
    });
  }

  /**
   * The lab can't use the sample (haemolysed, clotted, too little…): it is recorded and the order
   * goes back to "sample needed". Paid tests stay paid; the new sample gets a new number.
   */
  @Post('lab-orders/:id/reject')
  @Roles(...LAB)
  async reject(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(RejectSchema)) body: z.infer<typeof RejectSchema>) {
    return this.prisma.client.$transaction(async (tx) => {
      const order = await this.order(me, id, tx);
      if (order.status !== 'SAMPLE_COLLECTED' && order.status !== 'RESULTED') {
        throw new ConflictException(order.status === 'VERIFIED' ? 'This result is released: amend it instead' : 'There is no sample to reject');
      }
      const reason = REJECT_REASONS[body.reason];
      await tx.labSampleRejection.create({
        data: { tenantId: me.tenantId, labOrderId: id, sampleId: order.sampleId, reason, note: body.note, userId: me.sub },
      });
      await tx.labResultValue.deleteMany({ where: { labOrderId: id } });
      const updated = await tx.labOrder.update({
        where: { id },
        data: {
          status: 'ORDERED',
          sampleId: null,
          sampleCollectedAt: null,
          collectedById: null,
          resultValue: null,
          resultFlag: null,
          resultNote: null,
          rangeText: null,
          critical: false,
          resultedAt: null,
          resultedById: null,
          rejections: { increment: 1 },
          rejectReason: body.note ? `${reason}: ${body.note}` : reason,
        },
        include: orderInclude,
      });
      await this.audit.log(me, 'lab.reject', 'LabOrder', id, { sampleId: order.sampleId, reason, note: body.note }, tx);
      return updated;
    });
  }

  /** Checks the result against the test (answers, ranges for this patient) and summarises it. */
  private async evaluate(order: Order, body: { value?: string; values?: { componentId: string; value: string }[] }) {
    const t = order.labTest;
    const visit = await this.prisma.client.visit.findUniqueOrThrow({ where: { id: order.visitId }, select: { patient: { select: { sex: true, dateOfBirth: true } } } });
    // Judged at the time the sample was taken (a newborn's range on the day of birth, not today).
    const at = order.sampleCollectedAt ?? new Date();
    if (t.components.length) {
      // A panel: each component is checked against its own answers or range. Blank ones are not run.
      const panel: { componentId: string; value: string; flag: string | null; rangeText: string | null }[] = [];
      for (const entry of body.values ?? []) {
        if (!entry.value) continue;
        const c = t.components.find((x) => x.id === entry.componentId);
        if (!c) throw new ConflictException('That result does not belong to this test');
        panel.push({ componentId: c.id, value: entry.value, ...checkValue(c, entry.value, visit.patient, at) });
      }
      if (!panel.length) throw new ConflictException('Enter at least one result');
      // A one-line summary for lists and older screens; the full results are in `values`.
      const value = panel
        .map((v) => {
          const c = t.components.find((x) => x.id === v.componentId)!;
          return `${c.name} ${v.value}${v.flag && v.flag !== 'N' ? ` ${v.flag}` : ''}`;
        })
        .join('; ');
      const flag = worstFlag(panel.map((v) => v.flag));
      return { value, flag, rangeText: null, panel, critical: panel.some((v) => isCritical(v.flag)) };
    }
    if (!body.value) throw new ConflictException('Enter the result');
    const checked = checkValue(t, body.value, visit.patient, at);
    return { value: body.value, flag: checked.flag, rangeText: checked.rangeText, panel: null, critical: isCritical(checked.flag) };
  }

  /** Enters (or corrects, before verification) a result. Numeric results are flagged against the range. */
  @Post('lab-orders/:id/result')
  @Roles(...LAB)
  async result(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ResultSchema)) body: z.infer<typeof ResultSchema>) {
    const order = await this.order(me, id);
    if (order.status !== 'SAMPLE_COLLECTED' && order.status !== 'RESULTED') {
      throw new ConflictException(order.status === 'ORDERED' ? 'Collect the sample first' : 'This result is already verified: amend it instead');
    }
    const r = await this.evaluate(order, body);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (r.panel) {
        await tx.labResultValue.deleteMany({ where: { labOrderId: id } });
        await tx.labResultValue.createMany({ data: r.panel.map((v) => ({ ...v, tenantId: me.tenantId, labOrderId: id })) });
      }
      return tx.labOrder.update({
        where: { id },
        data: {
          status: 'RESULTED',
          resultValue: r.value,
          resultFlag: r.flag,
          rangeText: r.rangeText,
          critical: r.critical,
          resultNote: body.note || null,
          resultedAt: new Date(),
          resultedById: me.sub,
        },
        include: orderInclude,
      });
    });
    await this.audit.log(me, order.status === 'RESULTED' ? 'lab.correct' : 'lab.result', 'LabOrder', id, r.critical ? { critical: true } : undefined);
    return updated;
  }

  /**
   * Releases a result to the doctor. A critical result is first phoned to the doctor (or whoever
   * is responsible), and the lab records who was told and how; it then shows as an alert on the
   * queue and the visit until the doctor marks it seen.
   */
  @Post('lab-orders/:id/verify')
  @Roles(...LAB)
  async verify(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(VerifySchema)) body: z.infer<typeof VerifySchema>) {
    const order = await this.order(me, id);
    if (order.status !== 'RESULTED') throw new ConflictException('Only entered results can be verified');
    if (order.critical && !body.notified) {
      throw new ConflictException({ message: 'This is a critical result: phone the doctor, then record who was told', code: 'CRITICAL_NOT_NOTIFIED' });
    }
    const now = new Date();
    const updated = await this.prisma.client.labOrder.update({
      where: { id },
      data: {
        status: 'VERIFIED',
        verifiedAt: now,
        verifiedById: me.sub,
        ...(order.critical && { criticalNotified: body.notified, criticalNotifiedAt: now, alert: 'CRITICAL', alertSeenAt: null, alertSeenById: null }),
      },
      include: orderInclude,
    });
    await this.finishLabVisit(order.visitId);
    await this.audit.log(me, 'lab.verify', 'LabOrder', id, order.critical ? { critical: true, notified: body.notified } : undefined);
    return updated;
  }

  /**
   * Corrects a released result. The earlier result is kept with the reason, the report shows the
   * result as amended, and the doctor sees an alert until they mark it seen.
   */
  @Post('lab-orders/:id/amend')
  @Roles(...LAB)
  async amend(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(AmendSchema)) body: z.infer<typeof AmendSchema>) {
    const order = await this.order(me, id);
    if (order.status !== 'VERIFIED') throw new ConflictException('Only released results are amended; correct the result before verifying it');
    const r = await this.evaluate(order, body);
    if (r.critical && !body.notified) {
      throw new ConflictException({ message: 'The corrected result is critical: phone the doctor, then record who was told', code: 'CRITICAL_NOT_NOTIFIED' });
    }
    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.labAmendment.create({
        data: {
          tenantId: me.tenantId,
          labOrderId: id,
          previousValue: order.resultValue,
          previousFlag: order.resultFlag,
          previousValues: order.values.length ? (order.values as unknown as Prisma.InputJsonValue) : undefined,
          reason: body.reason,
          userId: me.sub,
        },
      });
      if (r.panel) {
        await tx.labResultValue.deleteMany({ where: { labOrderId: id } });
        await tx.labResultValue.createMany({ data: r.panel.map((v) => ({ ...v, tenantId: me.tenantId, labOrderId: id })) });
      }
      return tx.labOrder.update({
        where: { id },
        data: {
          resultValue: r.value,
          resultFlag: r.flag,
          rangeText: r.rangeText,
          critical: r.critical,
          resultNote: body.note || null,
          verifiedAt: now,
          verifiedById: me.sub,
          amendedAt: now,
          alert: r.critical ? 'CRITICAL' : 'AMENDED',
          alertSeenAt: null,
          alertSeenById: null,
          ...(r.critical && { criticalNotified: body.notified, criticalNotifiedAt: now }),
        },
        include: orderInclude,
      });
    });
    await this.audit.log(me, 'lab.amend', 'LabOrder', id, { reason: body.reason, from: order.resultValue, to: r.value, critical: r.critical });
    return updated;
  }

  /** The doctor (or nurse) has seen a critical or amended result. */
  @Post('lab-orders/:id/seen')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async seen(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const order = await this.order(me, id);
    if (!order.alert || order.alertSeenAt) return forViewer(order, me.role);
    const updated = await this.prisma.client.labOrder.update({ where: { id }, data: { alertSeenAt: new Date(), alertSeenById: me.sub }, include: orderInclude });
    await this.audit.log(me, 'lab.alert-seen', 'LabOrder', id, { alert: order.alert });
    return forViewer(updated, me.role);
  }

  /** A lab-only visit is finished once every test is released (or cancelled). */
  private async finishLabVisit(visitId: string) {
    const db = this.prisma.client;
    const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId }, select: { kind: true, status: true } });
    if (visit.kind !== 'LAB' || visit.status === 'COMPLETED') return;
    const open = await db.labOrder.count({ where: { visitId, status: { in: OPEN } } });
    if (!open) await db.visit.update({ where: { id: visitId }, data: { status: 'COMPLETED', completedAt: new Date() } });
  }

  /**
   * Tests without a consultation: the patient brings a request from another clinic, or asks for a
   * test themselves. Makes a lab-only visit (not in the doctor's queue) with its tests and
   * charges; from there it is the usual path: cashier (pay first), sample, result, release. The
   * visit closes by itself when the last result is released.
   */
  @Post('lab/walk-in')
  @Roles('ADMIN', 'LAB_TECH', 'RECEPTIONIST')
  async walkIn(@CurrentUser() me: AuthUser, @Body(new ZodPipe(WalkInSchema)) body: z.infer<typeof WalkInSchema>) {
    return this.prisma.client.$transaction(async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: body.patientId, tenantId: me.tenantId } });
      if (!patient) throw new NotFoundException('Patient not found');
      const tests = await tx.labTest.findMany({ where: { id: { in: body.labTestIds }, tenantId: me.tenantId, active: true } });
      if (tests.length !== body.labTestIds.length) throw new NotFoundException('One or more tests were not found');
      const visit = await tx.visit.create({
        data: { tenantId: me.tenantId, patientId: patient.id, kind: 'LAB', status: 'AWAITING_LAB', queueNumber: 0, calledAt: new Date() },
      });
      const byId = new Map(tests.map((t) => [t.id, t]));
      const now = Date.now();
      for (const [i, testId] of body.labTestIds.entries()) {
        const t = byId.get(testId)!;
        const order = await tx.labOrder.create({
          data: {
            tenantId: me.tenantId,
            visitId: visit.id,
            labTestId: t.id,
            orderedById: me.sub,
            orderedAt: new Date(now + i),
            requestedBy: body.requestedBy,
            urgent: body.urgent ?? false,
          },
        });
        if (Number(t.price) > 0) {
          await tx.charge.create({ data: { visitId: visit.id, source: 'LAB', sourceId: order.id, description: t.name, unitPrice: t.price } });
        }
      }
      await this.audit.log(me, 'lab.walk-in', 'Visit', visit.id, { tests: tests.map((t) => t.name), requestedBy: body.requestedBy, ...(body.urgent && { urgent: true }) }, tx);
      return { visitId: visit.id, tests: tests.length };
    });
  }

  /**
   * A patient's released results, newest first, from every visit: for trends (is the haemoglobin
   * rising?) and so nothing is repeated needlessly.
   */
  @Get('patients/:id/lab-results')
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH')
  async history(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Patient not found');
    const patient = await this.prisma.client.patient.findFirst({ where: { id, tenantId: me.tenantId }, select: { id: true } });
    if (!patient) throw new NotFoundException('Patient not found');
    return this.prisma.client.labOrder.findMany({
      where: { tenantId: me.tenantId, status: 'VERIFIED', visit: { patientId: id } },
      orderBy: [{ verifiedAt: 'desc' }, { id: 'asc' }],
      take: 200,
      include: { ...orderInclude, visit: { select: { id: true, kind: true } } },
    });
  }

  /** Everything needed to print a visit's verified results. */
  @Get('visits/:id/lab-report')
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH')
  async report(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const visit = await this.prisma.client.visit.findFirst({
      where: { id, tenantId: me.tenantId },
      select: {
        id: true,
        kind: true,
        checkedInAt: true,
        patient: { select: queuePatientSelect },
        doctor: { select: { fullName: true } },
        tenant: { select: { name: true, nameAm: true, phone: true, address: true } },
        labOrders: { where: { status: 'VERIFIED' }, orderBy: [{ orderedAt: 'asc' }, { id: 'asc' }], include: orderInclude },
      },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }
}

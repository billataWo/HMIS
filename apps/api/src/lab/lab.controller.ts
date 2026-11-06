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

const OrderSchema = z.object({
  labTestIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one test')
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'Each test may appear only once'),
});
const CollectSchema = z.object({ sampleId: z.string().trim().max(50).optional() });
const ResultSchema = z
  .object({
    value: z.string().trim().max(2000).optional(), // single-value tests
    values: z.array(z.object({ componentId: z.uuid(), value: z.string().trim().max(200) })).max(60).optional(), // panels
    note: z.string().trim().max(1000).optional(),
  })
  .refine((b) => (b.value && b.value.length > 0) || b.values?.some((v) => v.value), { message: 'Enter the result', path: ['value'] });

const LAB: Role[] = ['ADMIN', 'LAB_TECH'];
const OPEN: LabOrderStatus[] = ['ORDERED', 'SAMPLE_COLLECTED', 'RESULTED'];

const orderInclude = {
  labTest: {
    select: {
      id: true,
      name: true,
      loincCode: true,
      unit: true,
      refLow: true,
      refHigh: true,
      resultOptions: true,
      components: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, unit: true, refLow: true, refHigh: true, resultOptions: true } },
    },
  },
  values: { select: { componentId: true, value: true, flag: true } },
  orderedBy: { select: { id: true, fullName: true } },
  collectedBy: { select: { fullName: true } },
  resultedBy: { select: { fullName: true } },
  verifiedBy: { select: { fullName: true } },
} satisfies Prisma.LabOrderInclude;

/** Flags a numeric result against the reference range: L (low), H (high) or N (normal). */
export function flagResult(value: number, low: number | null, high: number | null) {
  if (low !== null && value < low) return 'L';
  if (high !== null && value > high) return 'H';
  return 'N';
}

type Checkable = { name: string; unit: string | null; refLow: { toString(): string } | null; refHigh: { toString(): string } | null; resultOptions: string[] };

/**
 * Validates one result against its answers or range and returns its flag: H/L/N for numeric
 * results with a range, null for answers and free text.
 */
function checkValue(c: Checkable, value: string): string | null {
  if (c.resultOptions.length) {
    if (!c.resultOptions.includes(value)) throw new ConflictException(`${c.name}: choose one of ${c.resultOptions.join(', ')}`);
    return null;
  }
  if (c.refLow === null && c.refHigh === null) return null;
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n)) throw new ConflictException(`${c.name} needs a number${c.unit ? ` in ${c.unit}` : ''}`);
  return flagResult(n, c.refLow === null ? null : Number(c.refLow), c.refHigh === null ? null : Number(c.refHigh));
}

/** Clinicians only see a value once the lab has verified it. */
function forViewer<T extends { status: LabOrderStatus; resultValue: string | null; resultFlag: string | null; resultNote: string | null; values: unknown[] }>(
  order: T,
  role: Role,
) {
  if (LAB.includes(role) || order.status === 'VERIFIED') return order;
  return { ...order, resultValue: null, resultFlag: null, resultNote: null, values: [] };
}

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
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH')
  tests(@CurrentUser() me: AuthUser) {
    return this.prisma.client.labTest.findMany({ where: { tenantId: me.tenantId, active: true }, orderBy: { name: 'asc' } });
  }

  @Get('visits/:id/lab-orders')
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH')
  async forVisit(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const orders = await this.prisma.client.labOrder.findMany({
      where: { visitId: id, tenantId: me.tenantId },
      orderBy: { orderedAt: 'asc' },
      include: orderInclude,
    });
    return orders.map((o) => forViewer(o, me.role));
  }

  @Post('visits/:id/lab-orders')
  @Roles('DOCTOR')
  async create(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(OrderSchema)) { labTestIds }: z.infer<typeof OrderSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    return this.prisma.client.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id, tenantId: me.tenantId } });
      if (!visit) throw new NotFoundException('Visit not found');
      if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') throw new ConflictException('This visit is closed');
      if (visit.kind === 'WALK_IN') throw new ConflictException('This is a pharmacy counter sale, not a consultation');
      if (visit.status === 'WAITING') throw new ConflictException('Call the patient in before ordering tests');

      const tests = await tx.labTest.findMany({ where: { id: { in: labTestIds }, tenantId: me.tenantId, active: true } });
      if (tests.length !== labTestIds.length) throw new NotFoundException('One or more tests were not found');
      const dup = await tx.labOrder.findFirst({
        where: { visitId: id, labTestId: { in: labTestIds }, status: { in: OPEN } },
        include: { labTest: { select: { name: true } } },
      });
      if (dup) throw new ConflictException(`${dup.labTest.name} is already ordered for this visit`);

      const created = [];
      for (const t of tests) {
        const order = await tx.labOrder.create({ data: { tenantId: me.tenantId, visitId: id, labTestId: t.id, orderedById: me.sub } });
        // Free tests (e.g. programme-funded HIV testing) create no charge, so nobody is sent to the cashier.
        if (Number(t.price) > 0) {
          await tx.charge.create({ data: { visitId: id, source: 'LAB', sourceId: order.id, description: t.name, unitPrice: t.price } });
        }
        created.push(order.id);
      }
      await this.audit.log(me, 'lab.order', 'Visit', id, { tests: tests.map((t) => t.name) }, tx);
      return tx.labOrder.findMany({ where: { id: { in: created } }, include: orderInclude });
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

  /** Open lab work, oldest first, with whether each test is paid; plus today's verified results. */
  @Get('lab/worklist')
  @Roles(...LAB)
  async worklist(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const include = { ...orderInclude, visit: { select: { id: true, queueNumber: true, patient: { select: queuePatientSelect } } } };
    const [open, verifiedToday, prepayment] = await Promise.all([
      db.labOrder.findMany({ where: { tenantId: me.tenantId, status: { in: OPEN } }, orderBy: { orderedAt: 'asc' }, include }),
      db.labOrder.findMany({
        where: { tenantId: me.tenantId, status: 'VERIFIED', verifiedAt: { gte: dayRange(clinicDay()).start } },
        orderBy: { verifiedAt: 'desc' },
        include,
      }),
      prepaymentRequired(db, me.tenantId),
    ]);
    const charges = await db.charge.findMany({
      where: { source: 'LAB', sourceId: { in: open.map((o) => o.id) } },
      select: { sourceId: true, ...settlementSelect },
    });
    // An order is paid when it has no unsettled charge (free tests have no charge at all).
    const unpaid = new Set(charges.filter((c) => !isSettled(c)).map((c) => c.sourceId));
    return { prepayment, open: open.map((o) => ({ ...o, paid: !unpaid.has(o.id) })), verifiedToday };
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
          sampleId: body.sampleId || `L-${id.slice(0, 8).toUpperCase()}`,
          sampleCollectedAt: new Date(),
          collectedById: me.sub,
        },
        include: orderInclude,
      });
      await this.audit.log(me, 'lab.collect', 'LabOrder', id, { sampleId: updated.sampleId }, tx);
      return updated;
    });
  }

  /** Enters (or corrects, before verification) a result. Numeric results are flagged against the range. */
  @Post('lab-orders/:id/result')
  @Roles(...LAB)
  async result(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ResultSchema)) body: z.infer<typeof ResultSchema>) {
    const order = await this.order(me, id);
    if (order.status !== 'SAMPLE_COLLECTED' && order.status !== 'RESULTED') {
      throw new ConflictException(order.status === 'ORDERED' ? 'Collect the sample first' : 'This result is already verified');
    }

    const t = order.labTest;
    let value: string;
    let flag: string | null = null;
    let panel: { componentId: string; value: string; flag: string | null }[] | null = null;

    if (t.components.length) {
      // A panel: each component is checked against its own answers or range. Blank ones are not run.
      panel = [];
      for (const entry of body.values ?? []) {
        if (!entry.value) continue;
        const c = t.components.find((x) => x.id === entry.componentId);
        if (!c) throw new ConflictException('That result does not belong to this test');
        panel.push({ componentId: c.id, value: entry.value, flag: checkValue(c, entry.value) });
      }
      if (!panel.length) throw new ConflictException('Enter at least one result');
      const flags = panel.map((v) => v.flag);
      flag = flags.includes('H') ? 'H' : flags.includes('L') ? 'L' : flags.includes('N') ? 'N' : null;
      // A one-line summary for lists and older screens; the full results are in `values`.
      value = panel
        .map((v) => {
          const c = t.components.find((x) => x.id === v.componentId)!;
          return `${c.name} ${v.value}${v.flag === 'H' || v.flag === 'L' ? ` ${v.flag}` : ''}`;
        })
        .join('; ');
    } else {
      if (!body.value) throw new ConflictException('Enter the result');
      value = body.value;
      flag = checkValue(t, body.value);
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (panel) {
        await tx.labResultValue.deleteMany({ where: { labOrderId: id } });
        await tx.labResultValue.createMany({ data: panel.map((v) => ({ ...v, tenantId: me.tenantId, labOrderId: id })) });
      }
      return tx.labOrder.update({
        where: { id },
        data: { status: 'RESULTED', resultValue: value, resultFlag: flag, resultNote: body.note || null, resultedAt: new Date(), resultedById: me.sub },
        include: orderInclude,
      });
    });
    await this.audit.log(me, order.status === 'RESULTED' ? 'lab.correct' : 'lab.result', 'LabOrder', id);
    return updated;
  }

  @Post('lab-orders/:id/verify')
  @Roles(...LAB)
  async verify(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const order = await this.order(me, id);
    if (order.status !== 'RESULTED') throw new ConflictException('Only entered results can be verified');
    const updated = await this.prisma.client.labOrder.update({
      where: { id },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: me.sub },
      include: orderInclude,
    });
    await this.audit.log(me, 'lab.verify', 'LabOrder', id);
    return updated;
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
        checkedInAt: true,
        patient: { select: queuePatientSelect },
        doctor: { select: { fullName: true } },
        tenant: { select: { name: true, nameAm: true, phone: true, address: true } },
        labOrders: { where: { status: 'VERIFIED' }, orderBy: { orderedAt: 'asc' }, include: orderInclude },
      },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }
}

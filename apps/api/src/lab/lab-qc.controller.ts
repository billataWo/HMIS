import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import type { Prisma, Role } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { qcStates, useReagents, westgard } from './qc.js';

const LAB: Role[] = ['ADMIN', 'LAB_TECH'];
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();
/** A date (YYYY-MM-DD) for an expiry: good through that whole day in Addis Ababa (its last moment). */
const expiry = z
  .string()
  .regex(DAY_PATTERN, 'Use a date like 2027-03-31')
  .transform((d) => new Date(dayRange(d).end.getTime() - 1))
  .nullable()
  .optional();

const ControlFields = {
  name: z.string().trim().min(2, 'Name the control (e.g. Level 1, normal)').max(100),
  lot: text(60),
  expiresAt: expiry,
  mean: z.number().nullable().optional(),
  sd: z.number().positive('The SD must be above zero').nullable().optional(),
  expected: text(60),
};
const hasTarget = (c: { mean?: number | null; sd?: number | null; expected?: string | null }) => (c.mean != null && c.sd != null) !== !!c.expected;
const ControlSchema = z
  .object({ labTestId: z.uuid(), ...ControlFields })
  .refine(hasTarget, { message: 'Give either the mean and SD (a measured control) or the expected answer (a kit control)', path: ['mean'] });
const ControlUpdateSchema = z.object({ ...ControlFields, name: ControlFields.name.optional(), active: z.boolean().optional() });
const RunSchema = z.object({ controlId: z.uuid(), value: z.string().trim().min(1, 'Enter the control result').max(60), note: text(300) });
const ActionSchema = z.object({ action: z.string().trim().min(3, 'Say what was done').max(500) });

const ReagentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  unit: z.string().trim().min(1).max(30),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
});
const ReagentUpdateSchema = z.object({
  name: ReagentSchema.shape.name.optional(),
  unit: ReagentSchema.shape.unit.optional(),
  reorderLevel: z.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
});
const ReceiveSchema = z.object({ quantity: z.number().int().min(1).max(1_000_000), lot: text(60), expiresAt: expiry });
export const ADJUST_REASONS = { COUNT: 'Counted', DAMAGED: 'Damaged or spilt', EXPIRED: 'Expired', OTHER: 'Other' } as const;
const AdjustSchema = z
  .object({
    lotId: z.uuid(),
    quantity: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((n) => n !== 0, 'Enter how many more (+) or fewer (−)'),
    reason: z.enum(Object.keys(ADJUST_REASONS) as [keyof typeof ADJUST_REASONS, ...(keyof typeof ADJUST_REASONS)[]]),
    note: text(300),
  })
  .refine((b) => b.reason !== 'OTHER' || !!b.note, { message: 'Say what happened', path: ['note'] });
const UsesSchema = z.object({
  uses: z
    .array(z.object({ labTestId: z.uuid(), perTest: z.number().int().min(1).max(1000) }))
    .max(50)
    .refine((u) => new Set(u.map((x) => x.labTestId)).size === u.length, 'Each test once'),
});

const EXPIRY_SOON_DAYS = 60;

/**
 * Quality control (controls per test, runs judged by the Westgard rules, failures that hold patient
 * results) and reagent stock (lots by expiry, a ledger of every change, and what each test uses).
 */
@Controller('lab')
export class LabQcController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Quality control ─────────────

  /** Every test with controls: where its QC stands, and each control's recent runs (for the chart). */
  @Get('qc')
  @Roles(...LAB)
  async qc(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const [controls, tests, states] = await Promise.all([
      db.labQcControl.findMany({
        where: { tenantId: me.tenantId },
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
        include: { results: { orderBy: { createdAt: 'desc' }, take: 30 } },
      }),
      db.labTest.findMany({ where: { tenantId: me.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true, resultOptions: true } }),
      qcStates(db, me.tenantId),
    ]);
    const withControls = tests.filter((t) => controls.some((c) => c.labTestId === t.id));
    return {
      today: clinicDay(),
      tests: withControls.map((t) => ({ ...t, state: states.get(t.id) ?? { status: 'OK', detail: null }, controls: controls.filter((c) => c.labTestId === t.id) })),
      allTests: tests,
    };
  }

  @Post('qc/controls')
  @Roles(...LAB)
  async addControl(@CurrentUser() me: AuthUser, @Body(new ZodPipe(ControlSchema)) body: z.infer<typeof ControlSchema>) {
    const test = await this.prisma.client.labTest.findFirst({ where: { id: body.labTestId, tenantId: me.tenantId } });
    if (!test) throw new NotFoundException('Lab test not found');
    const c = await this.prisma.client.labQcControl.create({
      data: { ...body, tenantId: me.tenantId, mean: body.mean?.toFixed(3) ?? null, sd: body.sd?.toFixed(3) ?? null },
    });
    await this.audit.log(me, 'lab.qc-control', 'LabQcControl', c.id, { test: test.name, name: c.name, lot: c.lot });
    return c;
  }

  @Patch('qc/controls/:id')
  @Roles(...LAB)
  async updateControl(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ControlUpdateSchema)) body: z.infer<typeof ControlUpdateSchema>) {
    const c = await this.control(me, id);
    const next = { mean: body.mean === undefined ? c.mean && Number(c.mean) : body.mean, sd: body.sd === undefined ? c.sd && Number(c.sd) : body.sd, expected: body.expected === undefined ? c.expected : body.expected };
    if (!hasTarget(next)) throw new ConflictException('Give either the mean and SD or the expected answer');
    const updated = await this.prisma.client.labQcControl.update({
      where: { id },
      data: { ...body, mean: body.mean === undefined ? undefined : (body.mean?.toFixed(3) ?? null), sd: body.sd === undefined ? undefined : (body.sd?.toFixed(3) ?? null) },
    });
    await this.audit.log(me, 'lab.qc-control', 'LabQcControl', id, { fields: Object.keys(body) });
    return updated;
  }

  /**
   * Records a control run. A measured control is judged by the Westgard rules against its earlier
   * runs and today's runs of the test's other levels; a kit control by whether it gave its answer.
   * A failed run holds the test's patient results until the control passes again.
   */
  @Post('qc/results')
  @Roles(...LAB)
  async run(@CurrentUser() me: AuthUser, @Body(new ZodPipe(RunSchema)) body: z.infer<typeof RunSchema>) {
    const c = await this.control(me, body.controlId);
    if (!c.active) throw new ConflictException('This control is no longer in use');
    if (c.expiresAt && c.expiresAt < new Date()) throw new ConflictException(`This control lot expired on ${clinicDay(c.expiresAt)}; open a new lot and add it`);
    let verdict: { status: 'PASS' | 'WARN' | 'FAIL'; rule: string | null };
    let z: number | null = null;
    if (c.expected) {
      verdict = body.value.toLowerCase() === c.expected.toLowerCase() ? { status: 'PASS', rule: null } : { status: 'FAIL', rule: `expected ${c.expected}` };
    } else {
      const v = Number(body.value.replace(',', '.'));
      if (!Number.isFinite(v)) throw new ConflictException('The control result is a number');
      z = (v - Number(c.mean)) / Number(c.sd);
      const [earlier, others] = await Promise.all([
        this.prisma.client.labQcResult.findMany({ where: { controlId: c.id, z: { not: null } }, orderBy: { createdAt: 'desc' }, take: 9, select: { z: true } }),
        this.prisma.client.labQcControl.findMany({
          where: { labTestId: c.labTestId, active: true, id: { not: c.id } },
          select: { results: { where: { createdAt: { gte: dayRange(clinicDay()).start }, z: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { z: true } } },
        }),
      ]);
      verdict = westgard(
        z,
        earlier.map((r) => Number(r.z)),
        others.flatMap((o) => o.results.map((r) => Number(r.z))),
      );
    }
    const { result, short } = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.labQcResult.create({
        data: { tenantId: me.tenantId, controlId: c.id, value: body.value, z: z === null ? null : z.toFixed(3), status: verdict.status, rule: verdict.rule, note: body.note, userId: me.sub },
      });
      // A control run uses a test's worth of reagent, like a patient's.
      return { result, short: await useReagents(tx, me.tenantId, c.labTestId, 'QC', me.sub) };
    });
    await this.audit.log(me, 'lab.qc', 'LabQcControl', c.id, { value: body.value, status: verdict.status, rule: verdict.rule });
    return { ...result, reagentShort: short };
  }

  /** What was done about a failed run (new reagent, recalibration…), before running the control again. */
  @Post('qc/results/:id/action')
  @Roles(...LAB)
  async action(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ActionSchema)) body: z.infer<typeof ActionSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('QC run not found');
    const r = await this.prisma.client.labQcResult.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!r) throw new NotFoundException('QC run not found');
    if (r.status !== 'FAIL') throw new ConflictException('Only failed runs need a corrective action');
    const updated = await this.prisma.client.labQcResult.update({ where: { id }, data: { action: body.action } });
    await this.audit.log(me, 'lab.qc-action', 'LabQcResult', id, { action: body.action });
    return updated;
  }

  private async control(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Control not found');
    const c = await this.prisma.client.labQcControl.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!c) throw new NotFoundException('Control not found');
    return c;
  }

  // ───────────── Reagents ─────────────

  /** Reagent stock: on hand (unexpired), lots by expiry, what is low or expiring, and what uses it. */
  @Get('reagents')
  @Roles(...LAB)
  async reagents(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRY_SOON_DAYS * 86_400_000);
    const [reagents, tests, unmatched] = await Promise.all([
      db.labReagent.findMany({
        where: { tenantId: me.tenantId },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: {
          lots: { where: { quantity: { gt: 0 } }, orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }] },
          uses: { include: { labTest: { select: { id: true, name: true } } } },
        },
      }),
      db.labTest.findMany({ where: { tenantId: me.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      // Used with none on record since the last count.
      db.labReagentMovement.groupBy({ by: ['reagentId'], where: { tenantId: me.tenantId, lotId: null }, _sum: { quantity: true } }),
    ]);
    return {
      reagents: reagents.map((r) => {
        const usable = r.lots.filter((l) => !l.expiresAt || l.expiresAt > now);
        const onHand = usable.reduce((s, l) => s + l.quantity, 0);
        return {
          ...r,
          onHand,
          low: r.active && onHand <= r.reorderLevel,
          expiringSoon: usable.filter((l) => l.expiresAt && l.expiresAt < soon).reduce((s, l) => s + l.quantity, 0),
          expired: r.lots.filter((l) => l.expiresAt && l.expiresAt <= now).reduce((s, l) => s + l.quantity, 0),
          usedWithoutStock: -(unmatched.find((u) => u.reagentId === r.id)?._sum.quantity ?? 0),
        };
      }),
      tests,
      adjustReasons: ADJUST_REASONS,
    };
  }

  @Post('reagents')
  @Roles(...LAB)
  async addReagent(@CurrentUser() me: AuthUser, @Body(new ZodPipe(ReagentSchema)) body: z.infer<typeof ReagentSchema>) {
    const exists = await this.prisma.client.labReagent.findFirst({ where: { tenantId: me.tenantId, name: { equals: body.name, mode: 'insensitive' } } });
    if (exists) throw new ConflictException('A reagent with this name already exists');
    const r = await this.prisma.client.labReagent.create({ data: { ...body, tenantId: me.tenantId } });
    await this.audit.log(me, 'lab.reagent', 'LabReagent', r.id, { name: r.name });
    return r;
  }

  @Patch('reagents/:id')
  @Roles(...LAB)
  async updateReagent(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ReagentUpdateSchema)) body: z.infer<typeof ReagentUpdateSchema>) {
    await this.reagent(me, id);
    const r = await this.prisma.client.labReagent.update({ where: { id }, data: body });
    await this.audit.log(me, 'lab.reagent', 'LabReagent', id, { fields: Object.keys(body) });
    return r;
  }

  /** A delivery: a new lot with its expiry, and its arrival in the ledger. */
  @Post('reagents/:id/receive')
  @Roles(...LAB)
  async receive(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ReceiveSchema)) body: z.infer<typeof ReceiveSchema>) {
    const r = await this.reagent(me, id);
    if (body.expiresAt && body.expiresAt < new Date()) throw new ConflictException('This lot has already expired');
    const lot = await this.prisma.client.$transaction(async (tx) => {
      const lot = await tx.labReagentLot.create({ data: { tenantId: me.tenantId, reagentId: id, lot: body.lot, expiresAt: body.expiresAt, quantity: body.quantity } });
      await tx.labReagentMovement.create({ data: { tenantId: me.tenantId, reagentId: id, lotId: lot.id, type: 'RECEIVE', quantity: body.quantity, userId: me.sub } });
      return lot;
    });
    await this.audit.log(me, 'lab.reagent-receive', 'LabReagent', id, { name: r.name, quantity: body.quantity, lot: body.lot });
    return lot;
  }

  /** A count, damage or expiry: the lot's quantity changes and the ledger says why. */
  @Post('reagents/:id/adjust')
  @Roles(...LAB)
  async adjust(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(AdjustSchema)) body: z.infer<typeof AdjustSchema>) {
    const r = await this.reagent(me, id);
    const lot = await this.prisma.client.$transaction(async (tx) => {
      const lot = await tx.labReagentLot.findFirst({ where: { id: body.lotId, reagentId: id } });
      if (!lot) throw new NotFoundException('That lot is not part of this reagent');
      if (lot.quantity + body.quantity < 0) throw new ConflictException(`Only ${lot.quantity} ${r.unit} left in this lot`);
      const updated = await tx.labReagentLot.update({ where: { id: lot.id }, data: { quantity: { increment: body.quantity } } });
      const reason = ADJUST_REASONS[body.reason];
      await tx.labReagentMovement.create({
        data: {
          tenantId: me.tenantId,
          reagentId: id,
          lotId: lot.id,
          type: body.reason === 'EXPIRED' ? 'EXPIRED' : 'ADJUST',
          quantity: body.quantity,
          reason: body.note ? `${reason}: ${body.note}` : reason,
          userId: me.sub,
        },
      });
      // A count also settles what was used with no stock on record.
      if (body.reason === 'COUNT') {
        const unmatched = await tx.labReagentMovement.aggregate({ where: { reagentId: id, lotId: null }, _sum: { quantity: true } });
        const owed = -(unmatched._sum.quantity ?? 0);
        if (owed > 0) await tx.labReagentMovement.create({ data: { tenantId: me.tenantId, reagentId: id, type: 'ADJUST', quantity: owed, reason: 'Settled by a count', userId: me.sub } });
      }
      return updated;
    });
    await this.audit.log(me, 'lab.reagent-adjust', 'LabReagent', id, { name: r.name, lot: lot.lot, quantity: body.quantity, reason: body.reason });
    return lot;
  }

  /** The last changes to one reagent's stock. */
  @Get('reagents/:id/movements')
  @Roles(...LAB)
  async movements(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.reagent(me, id);
    return this.prisma.client.labReagentMovement.findMany({
      where: { reagentId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { lotRow: { select: { lot: true } } },
    });
  }

  /** Which tests use this reagent, and how much per test (replaces the list). */
  @Put('reagents/:id/uses')
  @Roles(...LAB)
  async setUses(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(UsesSchema)) body: z.infer<typeof UsesSchema>) {
    const r = await this.reagent(me, id);
    const tests = await this.prisma.client.labTest.count({ where: { tenantId: me.tenantId, id: { in: body.uses.map((u) => u.labTestId) } } });
    if (tests !== body.uses.length) throw new NotFoundException('One or more tests were not found');
    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.labTestReagent.deleteMany({ where: { reagentId: id } });
      if (body.uses.length) await tx.labTestReagent.createMany({ data: body.uses.map((u) => ({ ...u, reagentId: id, tenantId: me.tenantId })) });
    });
    await this.audit.log(me, 'lab.reagent-uses', 'LabReagent', id, { name: r.name, tests: body.uses.length });
    return this.prisma.client.labTestReagent.findMany({ where: { reagentId: id }, include: { labTest: { select: { id: true, name: true } } } });
  }

  private async reagent(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Reagent not found');
    const r = await this.prisma.client.labReagent.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!r) throw new NotFoundException('Reagent not found');
    return r;
  }
}

import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { assertNotMerged } from '../patients/merged.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ageAt } from '../reports/reports.controller.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import {
  addDays,
  currentMethod,
  cyp,
  FP_LATE_AFTER_DAYS,
  FP_METHODS,
  type FpMethod,
  methodDef,
  nextDue,
  REMOVAL_REASONS,
  REMOVAL_WARNING_DAYS,
  STOP_REASONS,
} from './fp-rules.js';

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .optional();
const METHODS = Object.keys(FP_METHODS) as [FpMethod, ...FpMethod[]];

const GiveSchema = z.object({
  method: z.enum(METHODS),
  givenOn: z.string().regex(DAY_PATTERN).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  /** Her first modern method ever (NEW), or used one before, elsewhere (REPEAT). Ignored once she has been served here. */
  clientType: z.enum(['NEW', 'REPEAT']).optional(),
  note: text(500),
});
const RemovalSchema = z.object({
  givenOn: z.string().regex(DAY_PATTERN).optional(),
  reason: z.enum(Object.keys(REMOVAL_REASONS) as [keyof typeof REMOVAL_REASONS, ...(keyof typeof REMOVAL_REASONS)[]]),
  note: text(500),
});
const StopSchema = z.object({
  givenOn: z.string().regex(DAY_PATTERN).optional(),
  reason: z.enum(Object.keys(STOP_REASONS) as [keyof typeof STOP_REASONS, ...(keyof typeof STOP_REASONS)[]]),
  note: text(500),
});
const VoidSchema = z.object({ reason: z.string().trim().min(3, 'Give the reason').max(300) });

const FRONT = ['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'] as const;
type Rec = Prisma.FpRecordGetPayload<object>;
const entry = (r: Rec) => ({ ...r, givenOn: day(r.givenOn), nextDueOn: r.nextDueOn ? day(r.nextDueOn) : null });

/**
 * Family planning: methods started, resupplied, removed or stopped for each client, her current
 * method and when she is next due, clients due or late, and the monthly tally for the MoH report.
 */
@Controller()
export class FamilyPlanningController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async patient(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Patient not found');
    const p = await this.prisma.client.patient.findFirst({ where: { id, tenantId: me.tenantId }, select: { id: true, sex: true, dateOfBirth: true, mergedIntoId: true } });
    if (!p) throw new NotFoundException('Patient not found');
    return p;
  }

  private async names(ids: (string | null)[]) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const users = want.length ? await this.prisma.client.user.findMany({ where: { id: { in: want } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  /** Her records (newest first), her current method and when she is next due. */
  @Get('patients/:id/family-planning')
  @Roles(...FRONT)
  async forPatient(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.patient(me, id);
    const records = await this.prisma.client.fpRecord.findMany({ where: { patientId: id }, orderBy: [{ givenOn: 'desc' }, { createdAt: 'desc' }] });
    const names = await this.names(records.flatMap((r) => [r.createdById, r.voidedById]));
    const live = records.filter((r) => !r.voidedAt).map(entry);
    const current = currentMethod(live);
    const today = clinicDay();
    const def = current ? methodDef(current.method) : undefined;
    const due = current?.nextDueOn ?? null;
    return {
      records: records.map((r) => ({ ...entry(r), by: names.get(r.createdById) ?? null, voidedBy: r.voidedById ? (names.get(r.voidedById) ?? null) : null })),
      current: current
        ? {
            method: current.method,
            since: current.since,
            nextDueOn: due,
            device: def?.kind === 'DEVICE',
            late: !!due && def?.kind !== 'DEVICE' && addDays(due, FP_LATE_AFTER_DAYS) < today,
            removalDue: !!due && def?.kind === 'DEVICE' && due <= addDays(today, REMOVAL_WARNING_DAYS),
          }
        : null,
      // Served here before: every later service counts her as a repeat acceptor.
      servedBefore: live.some((r) => r.service === 'START' || r.service === 'RESUPPLY'),
    };
  }

  /** The live records of a patient, oldest first, with her patient row held (one change at a time). */
  private async held(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${id} FOR UPDATE`;
    const rows = await tx.fpRecord.findMany({ where: { patientId: id, voidedAt: null }, orderBy: [{ givenOn: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(entry);
  }

  /**
   * A method given: started (a new method, or a switch) or resupplied (the same method again).
   * Pills and condoms with a quantity; a device or injection once. Not during a pregnancy followed
   * here (condoms excepted), and a device in place is removed before another method replaces it.
   */
  @Post('patients/:id/family-planning')
  @Roles('DOCTOR', 'NURSE')
  async give(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(GiveSchema)) body: z.infer<typeof GiveSchema>) {
    const p = await this.patient(me, id);
    await assertNotMerged(this.prisma.client, p);
    const def = methodDef(body.method)!;
    if (def.sex !== 'ANY' && def.sex !== p.sex) throw new ConflictException(`${def.label} is for ${def.sex === 'FEMALE' ? 'women' : 'men'}`);
    const today = clinicDay();
    const givenOn = body.givenOn ?? today;
    if (givenOn > today) throw new ConflictException('The date is in the future');
    if ((ageAt(p.dateOfBirth, asDate(givenOn)) ?? 99) < 10) throw new ConflictException('Family planning is recorded from 10 years of age');
    if (def.unit && !body.quantity) throw new ConflictException(`Say how many ${def.unit} were given`);
    if (def.unit && body.quantity! > def.maxQuantity!) throw new ConflictException(`At most ${def.maxQuantity} ${def.unit} at a time`);
    const quantity = def.unit ? body.quantity! : null;
    if (!def.extra) {
      const pregnant = await this.prisma.client.pregnancy.findFirst({ where: { patientId: id, status: 'ACTIVE' }, select: { id: true } });
      if (pregnant) throw new ConflictException('She is followed in antenatal care: record family planning once the pregnancy has ended (condoms excepted)');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const live = await this.held(tx, id);
      const current = currentMethod(live);
      const currentDef = current ? methodDef(current.method) : undefined;
      if (!def.extra && current && currentDef?.kind === 'DEVICE') {
        throw new ConflictException(
          current.method === body.method ? `${def.label} is already in place: record its removal first, then the new one` : `She has ${currentDef.label}: record its removal first`,
        );
      }
      if (!def.extra && current?.method === body.method && def.kind === 'PERMANENT') throw new ConflictException(`${def.label} is already recorded`);
      if (current && givenOn < current.givenOn && !def.extra) throw new ConflictException('A later service is already recorded: check the date');
      const same = def.extra ? live.some((r) => r.method === body.method && (r.service === 'START' || r.service === 'RESUPPLY')) : current?.method === body.method;
      const service = same && (def.kind === 'SUPPLY' || def.kind === 'INJECTION' || def.kind === 'OTHER') ? 'RESUPPLY' : 'START';
      const servedBefore = live.some((r) => r.service === 'START' || r.service === 'RESUPPLY');
      const created = await tx.fpRecord.create({
        data: {
          tenantId: me.tenantId,
          patientId: id,
          givenOn: asDate(givenOn),
          service,
          method: body.method,
          clientType: servedBefore ? 'REPEAT' : (body.clientType ?? 'NEW'),
          quantity,
          nextDueOn: (() => {
            const d = nextDue(body.method, givenOn, quantity);
            return d ? asDate(d) : null;
          })(),
          note: body.note ?? null,
          createdById: me.sub,
        },
      });
      await this.audit.log(me, 'fp.give', 'Patient', id, { method: body.method, service, clientType: created.clientType }, tx);
      return entry(created);
    });
  }

  /** An implant or IUCD taken out, with why; "early" when before the end of its life. */
  @Post('patients/:id/family-planning/removal')
  @Roles('DOCTOR', 'NURSE')
  async removal(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(RemovalSchema)) body: z.infer<typeof RemovalSchema>) {
    await this.patient(me, id);
    const givenOn = body.givenOn ?? clinicDay();
    if (givenOn > clinicDay()) throw new ConflictException('The date is in the future');
    return this.prisma.client.$transaction(async (tx) => {
      const current = currentMethod(await this.held(tx, id));
      if (!current || methodDef(current.method)?.kind !== 'DEVICE') throw new ConflictException('She has no implant or IUCD recorded here');
      if (givenOn < current.since) throw new ConflictException('That is before it was put in: check the date');
      const created = await tx.fpRecord.create({
        data: { tenantId: me.tenantId, patientId: id, givenOn: asDate(givenOn), service: 'REMOVAL', method: current.method, reason: body.reason, note: body.note ?? null, createdById: me.sub },
      });
      const early = !!current.nextDueOn && givenOn < current.nextDueOn;
      await this.audit.log(me, 'fp.removal', 'Patient', id, { method: current.method, reason: body.reason, early }, tx);
      return { ...entry(created), early };
    });
  }

  /** A method she stops (not a device: that is removed), with why. */
  @Post('patients/:id/family-planning/stop')
  @Roles('DOCTOR', 'NURSE')
  async stop(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(StopSchema)) body: z.infer<typeof StopSchema>) {
    await this.patient(me, id);
    const givenOn = body.givenOn ?? clinicDay();
    if (givenOn > clinicDay()) throw new ConflictException('The date is in the future');
    return this.prisma.client.$transaction(async (tx) => {
      const current = currentMethod(await this.held(tx, id));
      if (!current) throw new ConflictException('She has no current method recorded here');
      const kind = methodDef(current.method)?.kind;
      if (kind === 'DEVICE') throw new ConflictException('An implant or IUCD is removed, not stopped: record its removal');
      if (kind === 'PERMANENT') throw new ConflictException('A permanent method is not stopped');
      if (givenOn < current.givenOn) throw new ConflictException('A later service is already recorded: check the date');
      const created = await tx.fpRecord.create({
        data: { tenantId: me.tenantId, patientId: id, givenOn: asDate(givenOn), service: 'STOP', method: current.method, reason: body.reason, note: body.note ?? null, createdById: me.sub },
      });
      await this.audit.log(me, 'fp.stop', 'Patient', id, { method: current.method, reason: body.reason }, tx);
      return entry(created);
    });
  }

  /** A record entered by mistake: kept, marked void with the reason; her current method is worked out again without it. */
  @Post('fp-records/:id/void')
  @Roles('DOCTOR', 'NURSE')
  async void(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(VoidSchema)) { reason }: z.infer<typeof VoidSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Record not found');
    const r = await this.prisma.client.fpRecord.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!r) throw new NotFoundException('Record not found');
    if (r.voidedAt) throw new ConflictException('This entry is already void');
    const updated = await this.prisma.client.fpRecord.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason, voidedById: me.sub } });
    await this.audit.log(me, 'fp.void', 'Patient', r.patientId, { method: r.method, service: r.service });
    return entry(updated);
  }

  /**
   * Clients due back: a resupply due this week or late (late more than two weeks past it), and
   * implants or IUCDs due out within a month. Late ones first.
   */
  @Get('family-planning/due')
  @Roles(...FRONT)
  async due(@CurrentUser() me: AuthUser) {
    const today = clinicDay();
    const rows = await this.prisma.client.fpRecord.findMany({
      where: { tenantId: me.tenantId, voidedAt: null, patient: { mergedIntoId: null } },
      orderBy: [{ givenOn: 'asc' }, { createdAt: 'asc' }],
    });
    const byPatient = new Map<string, ReturnType<typeof entry>[]>();
    for (const r of rows) byPatient.set(r.patientId, [...(byPatient.get(r.patientId) ?? []), entry(r)]);
    const due: { patientId: string; method: string; nextDueOn: string; removal: boolean; late: boolean; daysLate: number }[] = [];
    for (const [patientId, records] of byPatient) {
      const c = currentMethod(records);
      if (!c?.nextDueOn) continue;
      const device = methodDef(c.method)?.kind === 'DEVICE';
      if (c.nextDueOn > addDays(today, device ? REMOVAL_WARNING_DAYS : 7)) continue;
      const daysLate = Math.max(0, Math.round((Date.parse(today) - Date.parse(c.nextDueOn)) / 86_400_000));
      due.push({ patientId, method: c.method, nextDueOn: c.nextDueOn, removal: device, late: !device && daysLate > FP_LATE_AFTER_DAYS, daysLate });
    }
    const patients = await this.prisma.client.patient.findMany({ where: { id: { in: due.map((d) => d.patientId) } }, select: queuePatientSelect });
    const byId = new Map(patients.map((p) => [p.id, p]));
    return due
      .map(({ patientId, ...d }) => ({ ...d, patient: byId.get(patientId)! }))
      .sort((a, b) => Number(b.late) - Number(a.late) || b.daysLate - a.daysLate || a.nextDueOn.localeCompare(b.nextDueOn));
  }
}

/** Age bands for family planning acceptors (the MoH report's). */
const FP_AGES = [
  { key: '10-14', max: 15 },
  { key: '15-19', max: 20 },
  { key: '20-24', max: 25 },
  { key: '25-49', max: 50 },
  { key: '50+', max: Infinity },
];

/** The month's family planning tally for the MoH report: acceptors new and repeat by method and age, removals, CYP. */
export async function fpTally(db: Pick<Prisma.TransactionClient, 'fpRecord'>, tenantId: string, start: string, end: string) {
  const rows = await db.fpRecord.findMany({
    where: { tenantId, voidedAt: null, givenOn: { gte: asDate(start), lt: asDate(end) } },
    select: { method: true, service: true, clientType: true, quantity: true, givenOn: true, patientId: true, patient: { select: { dateOfBirth: true } } },
  });
  const given = rows.filter((r) => r.service === 'START' || r.service === 'RESUPPLY');
  const removals = rows.filter((r) => r.service === 'REMOVAL');
  // An early removal: before the end of the device's life (from its last insertion).
  const inserted = removals.length
    ? await db.fpRecord.findMany({ where: { tenantId, voidedAt: null, service: 'START', patientId: { in: removals.map((r) => r.patientId) } }, select: { patientId: true, method: true, givenOn: true, nextDueOn: true } })
    : [];
  const early = removals.filter((r) => {
    const insertion = inserted.filter((i) => i.patientId === r.patientId && i.method === r.method && i.givenOn <= r.givenOn).sort((a, b) => b.givenOn.getTime() - a.givenOn.getTime())[0];
    return !!insertion?.nextDueOn && r.givenOn < insertion.nextDueOn;
  });
  const band = (dob: Date | null, at: Date) => (dob ? (FP_AGES.find((a) => (ageAt(dob, at) ?? 0) < a.max)?.key ?? '50+') : 'unknown');
  const count = (xs: typeof given, type: string) => xs.filter((r) => r.clientType === type).length;
  return {
    acceptorsNew: count(given, 'NEW'),
    acceptorsRepeat: count(given, 'REPEAT'),
    byMethod: (Object.keys(FP_METHODS) as FpMethod[])
      .map((m) => ({ method: m, label: FP_METHODS[m].label, new: count(given.filter((r) => r.method === m), 'NEW'), repeat: count(given.filter((r) => r.method === m), 'REPEAT') }))
      .filter((r) => r.new + r.repeat > 0),
    byAge: [...FP_AGES.map((a) => a.key), 'unknown']
      .map((key) => {
        const xs = given.filter((r) => band(r.patient.dateOfBirth, r.givenOn) === key);
        return { ageGroup: key, new: count(xs, 'NEW'), repeat: count(xs, 'REPEAT') };
      })
      .filter((r) => r.new + r.repeat > 0),
    removals: removals.length,
    earlyRemovals: early.length,
    removalsByMethod: [...new Set(removals.map((r) => r.method))].map((m) => ({ method: m, label: methodDef(m)?.label ?? m, count: removals.filter((r) => r.method === m).length })),
    cyp: Math.round(rows.reduce((s, r) => s + cyp(r.method, r.service, r.quantity), 0) * 10) / 10,
  };
}

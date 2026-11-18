import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { assertNotMerged } from '../patients/merged.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import { addDays, addMonths, doseLabel, findDose, FULLY_IMMUNIZED, type Given, SCHEDULE, scheduleFor, TRACED, VACCINES, type Vaccine } from './schedule.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .optional();

const GiveSchema = z
  .object({
    vaccine: z.enum(Object.keys(VACCINES) as [Vaccine, ...Vaccine[]]),
    doseNo: z.number().int().min(0).max(9),
    givenOn: z.string().regex(DAY_PATTERN).optional(),
    lotNo: text(60),
    site: text(60),
    elsewhere: z.boolean().default(false),
    facility: text(200),
    note: text(500),
  })
  .refine((b) => !b.elsewhere || !!b.facility, { message: 'Say where it was given', path: ['facility'] });
const VoidSchema = z.object({ reason: z.string().trim().min(3, 'Give the reason').max(300) });
const FollowUpSchema = z.object({
  outcome: z.enum(['WILL_COME', 'NO_ANSWER', 'WRONG_NUMBER', 'VACCINATED_ELSEWHERE', 'MOVED_AWAY']),
  note: text(500),
});

/** What can follow a vaccine (the EPI AEFI reporting form's common events). */
export const AEFI_SIGNS = {
  INJECTION_SITE: 'Swelling, redness or abscess at the injection site',
  FEVER: 'High fever (39 °C or more)',
  RASH: 'Rash',
  CRYING: 'Crying for 3 hours or more',
  SEIZURE: 'Fits (convulsions)',
  HHE: 'Floppy, pale and unresponsive',
  ANAPHYLAXIS: 'Severe allergic reaction (anaphylaxis)',
  BCG_LYMPHADENITIS: 'BCG: swollen lymph node',
  OTHER: 'Other',
} as const;
type AefiSign = keyof typeof AEFI_SIGNS;
export const AEFI_OUTCOMES = ['RECOVERED', 'RECOVERING', 'NOT_RECOVERED', 'DIED', 'UNKNOWN'] as const;
const reported = {
  reportedTo: text(200),
  reportedOn: z.string().regex(DAY_PATTERN).optional(),
};
const AefiSchema = z
  .object({
    doseId: z.uuid().optional(),
    onsetOn: z.string().regex(DAY_PATTERN),
    signs: z.array(z.enum(Object.keys(AEFI_SIGNS) as [AefiSign, ...AefiSign[]])).min(1, 'Tick what happened').max(10),
    /** Death, admission to hospital, disability or life-threatening. */
    serious: z.boolean().default(false),
    outcome: z.enum(AEFI_OUTCOMES).default('UNKNOWN'),
    ...reported,
    note: text(1000),
  })
  .refine((b) => !b.signs.includes('OTHER') || !!b.note, { message: 'Say what happened', path: ['note'] })
  .refine((b) => !b.reportedOn || !!b.reportedTo, { message: 'Say who it was reported to', path: ['reportedTo'] });
const AefiUpdateSchema = z
  .object({ outcome: z.enum(AEFI_OUTCOMES).optional(), ...reported, note: text(1000) })
  .refine((b) => !b.reportedOn || !!b.reportedTo, { message: 'Say who it was reported to', path: ['reportedTo'] });

const CLINICAL = ['ADMIN', 'DOCTOR', 'NURSE'] as const;
const FRONT = ['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'] as const;
/** Follow-ups after which a child leaves the defaulter list until a new dose is recorded. */
const CLOSED = ['VACCINATED_ELSEWHERE', 'MOVED_AWAY'];

const day = (d: Date) => d.toISOString().slice(0, 10);
const asGiven = (d: { id: string; vaccine: string; doseNo: number; givenOn: Date }): Given => ({ id: d.id, vaccine: d.vaccine, doseNo: d.doseNo, givenOn: day(d.givenOn) });

/**
 * Immunization (EPI): each person's schedule worked out from their birth date, doses given here or
 * recorded from a card, children due or late (defaulters) with the calls made to bring them back.
 */
@Controller()
export class ImmunizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async patient(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Patient not found');
    const p = await this.prisma.client.patient.findFirst({ where: { id, tenantId: me.tenantId }, select: { id: true, sex: true, dateOfBirth: true, dobEstimated: true, mergedIntoId: true } });
    if (!p) throw new NotFoundException('Patient not found');
    return p;
  }

  /** The patient's schedule (when the birth date or age is known), every dose recorded, and the follow-up calls. */
  @Get('patients/:id/immunizations')
  @Roles(...FRONT)
  async forPatient(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const p = await this.patient(me, id);
    const db = this.prisma.client;
    const [doses, calls, aefis] = await Promise.all([
      db.immunizationDose.findMany({ where: { patientId: id }, orderBy: [{ givenOn: 'asc' }, { createdAt: 'asc' }] }),
      db.immunizationFollowUp.findMany({ where: { patientId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      db.immunizationAefi.findMany({ where: { patientId: id }, orderBy: { onsetOn: 'desc' }, include: { dose: { select: { vaccine: true, doseNo: true, givenOn: true } } } }),
    ]);
    const names = await this.names([...doses.flatMap((d) => [d.givenById, d.voidedById]), ...calls.map((c) => c.createdById), ...aefis.map((a) => a.createdById)]);
    const live = doses.filter((d) => !d.voidedAt);
    return {
      dobKnown: !!p.dateOfBirth,
      dobEstimated: p.dobEstimated,
      schedule: p.dateOfBirth ? scheduleFor({ dob: day(p.dateOfBirth), sex: p.sex }, live.map(asGiven), clinicDay()) : [],
      doses: doses.map((d) => ({ ...d, label: doseLabel(d.vaccine as Vaccine, d.doseNo), givenBy: names.get(d.givenById) ?? null, voidedBy: d.voidedById ? (names.get(d.voidedById) ?? null) : null })),
      followUps: calls.map((c) => ({ ...c, by: names.get(c.createdById) ?? null })),
      aefis: aefis.map((a) => ({ ...a, doseLabel: a.dose ? doseLabel(a.dose.vaccine as Vaccine, a.dose.doseNo) : null, by: names.get(a.createdById) ?? null })),
    };
  }

  /**
   * An adverse event after a vaccine. Serious ones (death, admission, disability, life-threatening)
   * must be reported to the woreda at once: until it is recorded as reported, the event shows as
   * waiting on the immunization page.
   */
  @Post('patients/:id/aefis')
  @Roles('DOCTOR', 'NURSE')
  async addAefi(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(AefiSchema)) body: z.infer<typeof AefiSchema>) {
    const p = await this.patient(me, id);
    await assertNotMerged(this.prisma.client, p);
    const today = clinicDay();
    if (body.onsetOn > today || (body.reportedOn && body.reportedOn > today)) throw new ConflictException('The date is in the future');
    if (body.reportedOn && body.reportedOn < body.onsetOn) throw new ConflictException('It was reported before it began: check the dates');
    if (body.doseId) {
      const dose = await this.prisma.client.immunizationDose.findFirst({ where: { id: body.doseId, patientId: id, tenantId: me.tenantId, voidedAt: null } });
      if (!dose) throw new NotFoundException('Dose not found');
      if (body.onsetOn < day(dose.givenOn)) throw new ConflictException('It began before the dose was given: check the dates');
    }
    const created = await this.prisma.client.immunizationAefi.create({
      data: {
        tenantId: me.tenantId,
        patientId: id,
        doseId: body.doseId ?? null,
        onsetOn: new Date(`${body.onsetOn}T00:00:00Z`),
        signs: [...new Set(body.signs)],
        // A death is always serious.
        serious: body.serious || body.outcome === 'DIED',
        outcome: body.outcome,
        reportedTo: body.reportedTo ?? null,
        reportedOn: body.reportedOn ? new Date(`${body.reportedOn}T00:00:00Z`) : null,
        note: body.note ?? null,
        createdById: me.sub,
      },
    });
    await this.audit.log(me, 'immunization.aefi', 'Patient', id, { serious: created.serious, outcome: created.outcome });
    return created;
  }

  /** How it ended, and when and to whom it was reported. */
  @Patch('aefis/:id')
  @Roles('DOCTOR', 'NURSE')
  async updateAefi(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(AefiUpdateSchema)) body: z.infer<typeof AefiUpdateSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('AEFI not found');
    const a = await this.prisma.client.immunizationAefi.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!a) throw new NotFoundException('AEFI not found');
    if (body.reportedOn && (body.reportedOn > clinicDay() || body.reportedOn < day(a.onsetOn))) throw new ConflictException('Check the date it was reported');
    const updated = await this.prisma.client.immunizationAefi.update({
      where: { id },
      data: {
        ...(body.outcome && { outcome: body.outcome, ...(body.outcome === 'DIED' && { serious: true }) }),
        ...(body.reportedTo !== undefined && { reportedTo: body.reportedTo }),
        ...(body.reportedOn && { reportedOn: new Date(`${body.reportedOn}T00:00:00Z`) }),
        ...(body.note !== undefined && { note: body.note }),
      },
    });
    await this.audit.log(me, 'immunization.aefi-update', 'Patient', a.patientId, { fields: Object.keys(body), outcome: updated.outcome });
    return updated;
  }

  /** AEFIs of the last 90 days for the EPI focal person: serious ones not yet reported first. */
  @Get('immunizations/aefis')
  @Roles(...CLINICAL)
  async aefis(@CurrentUser() me: AuthUser) {
    const since = new Date(`${addDays(clinicDay(), -90)}T00:00:00Z`);
    const rows = await this.prisma.client.immunizationAefi.findMany({
      where: { tenantId: me.tenantId, onsetOn: { gte: since } },
      orderBy: { onsetOn: 'desc' },
      include: { patient: { select: queuePatientSelect }, dose: { select: { vaccine: true, doseNo: true } } },
    });
    const pending = (a: { serious: boolean; reportedOn: Date | null }) => a.serious && !a.reportedOn;
    return rows
      .map((a) => ({ ...a, doseLabel: a.dose ? doseLabel(a.dose.vaccine as Vaccine, a.dose.doseNo) : null, reportPending: pending(a) }))
      .sort((x, y) => Number(y.reportPending) - Number(x.reportPending));
  }

  /**
   * Records a dose. Given here: in its order, not before its earliest date, and within its age
   * window. Recorded from another facility's card: as written, with where.
   */
  @Post('patients/:id/immunizations')
  @Roles('DOCTOR', 'NURSE')
  async give(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(GiveSchema)) body: z.infer<typeof GiveSchema>) {
    const p = await this.patient(me, id);
    await assertNotMerged(this.prisma.client, p);
    if (!p.dateOfBirth) throw new ConflictException("Record the patient's birth date or age first: the schedule is worked out from it");
    const def = findDose(body.vaccine, body.doseNo);
    const label = doseLabel(body.vaccine, body.doseNo);
    if (!def) throw new ConflictException(`There is no ${label} in the schedule`);
    if (def.female && p.sex !== 'FEMALE') throw new ConflictException(`${label} is for girls and women`);
    const today = clinicDay();
    const givenOn = body.givenOn ?? today;
    const dob = day(p.dateOfBirth);
    if (givenOn > today) throw new ConflictException('The date is in the future');
    if (givenOn < dob) throw new ConflictException('The date is before the patient was born');

    return this.prisma.client.$transaction(async (tx) => {
      // One live record per dose, even with two nurses at once: hold the patient's row.
      await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${id} FOR UPDATE`;
      const live = await tx.immunizationDose.findMany({ where: { patientId: id, voidedAt: null } });
      const same = live.find((d) => d.vaccine === body.vaccine && d.doseNo === body.doseNo);
      if (same) throw new ConflictException(`${label} is already recorded, given ${day(same.givenOn)}`);
      if (!body.elsewhere) {
        // The schedule as it stood on the day it was given.
        const dose = scheduleFor({ dob, sex: p.sex }, live.map(asGiven), givenOn, body.vaccine).find((d) => d.vaccine === body.vaccine && d.doseNo === body.doseNo);
        if (!dose) throw new ConflictException(`${label} is not in this patient's schedule`);
        if (dose.waitingFor) throw new ConflictException(`Give ${dose.waitingFor} first`);
        if (dose.status === 'MISSED') throw new ConflictException(`${label} is not given at this age any more`);
        if (givenOn < dose.notBefore) throw new ConflictException(`Too early: ${label} is not given before ${dose.notBefore}`);
      }
      const created = await tx.immunizationDose.create({
        data: {
          tenantId: me.tenantId,
          patientId: id,
          vaccine: body.vaccine,
          doseNo: body.doseNo,
          givenOn: new Date(`${givenOn}T00:00:00Z`),
          lotNo: body.lotNo,
          site: body.site,
          elsewhere: body.elsewhere,
          facility: body.elsewhere ? body.facility : null,
          note: body.note,
          givenById: me.sub,
        },
      });
      await this.audit.log(me, 'immunization.give', 'Patient', id, { dose: label, elsewhere: body.elsewhere }, tx);
      return { ...created, label };
    });
  }

  /** A dose recorded by mistake (wrong child, wrong vaccine): kept, marked void, with the reason. */
  @Post('immunizations/:id/void')
  @Roles(...CLINICAL)
  async void(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(VoidSchema)) { reason }: z.infer<typeof VoidSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Dose not found');
    const d = await this.prisma.client.immunizationDose.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!d) throw new NotFoundException('Dose not found');
    if (d.voidedAt) throw new ConflictException('This entry is already void');
    const updated = await this.prisma.client.immunizationDose.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason, voidedById: me.sub } });
    await this.audit.log(me, 'immunization.void', 'Patient', d.patientId, { dose: doseLabel(d.vaccine as Vaccine, d.doseNo) });
    return updated;
  }

  /**
   * Children under 5 in the clinic's immunization care (at least one dose recorded here) with a
   * childhood vaccine due or late: late ones (defaulters) first, the latest first among them. Those
   * reported vaccinated elsewhere or moved away leave the list until a new dose is recorded.
   */
  @Get('immunizations/due')
  @Roles(...FRONT)
  async due(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const today = clinicDay();
    const fiveYearsAgo = new Date(`${addMonths(today, -60)}T00:00:00Z`);
    const children = await db.patient.findMany({
      where: { tenantId: me.tenantId, mergedIntoId: null, dateOfBirth: { gt: fiveYearsAgo }, immunizations: { some: { voidedAt: null } } },
      select: {
        ...queuePatientSelect,
        immunizations: { where: { voidedAt: null }, select: { id: true, vaccine: true, doseNo: true, givenOn: true, createdAt: true } },
        immunizationCalls: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const callers = await this.names(children.flatMap((c) => c.immunizationCalls.map((x) => x.createdById)));
    const weekAhead = addDays(today, 7);
    const rows = children.flatMap(({ immunizations, immunizationCalls, ...patient }) => {
      const last = immunizationCalls[0];
      const lastDose = immunizations.reduce<Date | null>((m, d) => (!m || d.createdAt > m ? d.createdAt : m), null);
      if (last && CLOSED.includes(last.outcome) && (!lastDose || lastDose < last.createdAt)) return [];
      const doses = scheduleFor({ dob: day(patient.dateOfBirth!), sex: patient.sex }, immunizations.map(asGiven), today).filter(
        (d) => TRACED.includes(d.vaccine) && !d.waitingFor && (d.status === 'OVERDUE' || d.status === 'DUE' || (d.status === 'UPCOMING' && d.dueOn <= weekAhead)),
      );
      if (!doses.length) return [];
      const overdue = doses.filter((d) => d.status === 'OVERDUE');
      const late = overdue.length ? Math.max(...overdue.map((d) => (Date.parse(today) - Date.parse(d.dueOn)) / 86_400_000)) : 0;
      return [
        {
          patient,
          defaulter: overdue.length > 0,
          daysLate: Math.round(late),
          doses: doses.map((d) => ({ label: d.label, status: d.status, dueOn: d.dueOn })),
          lastFollowUp: last ? { outcome: last.outcome, note: last.note, at: last.createdAt, by: callers.get(last.createdById) ?? null } : null,
        },
      ];
    });
    return rows.sort((a, b) => Number(b.defaulter) - Number(a.defaulter) || b.daysLate - a.daysLate);
  }

  /** What came of a call (or a home visit) to a child who missed a vaccine. */
  @Post('patients/:id/immunization-follow-ups')
  @Roles(...FRONT)
  async followUp(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(FollowUpSchema)) body: z.infer<typeof FollowUpSchema>) {
    await this.patient(me, id);
    const f = await this.prisma.client.immunizationFollowUp.create({ data: { tenantId: me.tenantId, patientId: id, outcome: body.outcome, note: body.note ?? null, createdById: me.sub } });
    await this.audit.log(me, 'immunization.follow-up', 'Patient', id, { outcome: body.outcome });
    return f;
  }

  private async names(ids: (string | null)[]) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const users = want.length ? await this.prisma.client.user.findMany({ where: { id: { in: want } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
  }
}

/** The month's immunization tally for the MoH report: doses given here by age, fully immunized, drop-out. */
export async function immunizationTally(db: Prisma.TransactionClient | { immunizationDose: Prisma.TransactionClient['immunizationDose'] }, tenantId: string, start: string, end: string) {
  const given = await db.immunizationDose.findMany({
    where: { tenantId, voidedAt: null, elsewhere: false, givenOn: { gte: new Date(`${start}T00:00:00Z`), lt: new Date(`${end}T00:00:00Z`) } },
    select: { patientId: true, vaccine: true, doseNo: true, givenOn: true, patient: { select: { dateOfBirth: true } } },
  });
  const rows = SCHEDULE.map((d) => {
    const these = given.filter((g) => g.vaccine === d.vaccine && g.doseNo === d.doseNo);
    const under1 = these.filter((g) => g.patient.dateOfBirth && day(g.givenOn) < addMonths(day(g.patient.dateOfBirth), 12)).length;
    return { vaccine: d.vaccine, doseNo: d.doseNo, label: doseLabel(d.vaccine, d.doseNo), under1, over1: these.length - under1 };
  }).filter((r) => r.under1 + r.over1 > 0);
  // Fully immunized this month: the child's last required dose was given this month, before the first birthday.
  const children = [...new Set(given.map((g) => g.patientId))];
  const all = children.length
    ? await db.immunizationDose.findMany({ where: { patientId: { in: children }, voidedAt: null }, select: { patientId: true, vaccine: true, doseNo: true, givenOn: true, patient: { select: { dateOfBirth: true } } } })
    : [];
  let fullyImmunized = 0;
  for (const id of children) {
    const mine = all.filter((d) => d.patientId === id);
    const required = FULLY_IMMUNIZED.map(([v, n]) => mine.find((d) => d.vaccine === v && d.doseNo === n));
    if (required.some((d) => !d)) continue;
    const lastOn = required.reduce((m, d) => (day(d!.givenOn) > m ? day(d!.givenOn) : m), '');
    const dob = mine[0].patient.dateOfBirth;
    if (lastOn >= start && lastOn < end && dob && lastOn < addMonths(day(dob), 12)) fullyImmunized++;
  }
  const count = (v: string, n: number) => rows.find((r) => r.vaccine === v && r.doseNo === n);
  const total = (v: string, n: number) => (count(v, n)?.under1 ?? 0) + (count(v, n)?.over1 ?? 0);
  const dropOut = (a: number, b: number) => (a ? Math.round(((a - b) / a) * 1000) / 10 : null);
  return {
    doses: rows,
    fullyImmunized,
    dropOut: { penta1ToPenta3: dropOut(total('PENTA', 1), total('PENTA', 3)), penta1ToMeasles1: dropOut(total('PENTA', 1), total('MCV', 1)) },
  };
}

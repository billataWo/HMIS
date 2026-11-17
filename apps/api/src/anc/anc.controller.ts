import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
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
  ANC_LATE_AFTER_DAYS,
  addDays,
  ancAlerts,
  DANGER_SIGNS,
  type DangerSign,
  derivedRisks,
  eddFrom,
  gestation,
  lmpFromEdd,
  nextContactOn,
  RISK_FACTORS,
  type RiskFactor,
  TEST_RESULTS,
  URINE_PROTEIN,
} from './anc-rules.js';

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .optional();
const int = (min: number, max: number) => z.number().int().min(min).max(max).nullable().optional();
const RISKS = Object.keys(RISK_FACTORS) as [RiskFactor, ...RiskFactor[]];
const SIGNS = Object.keys(DANGER_SIGNS) as [DangerSign, ...DangerSign[]];

const RegisterSchema = z
  .object({
    lmp: z.string().regex(DAY_PATTERN).optional(),
    /** From an ultrasound: the period is worked back from it. */
    edd: z.string().regex(DAY_PATTERN).optional(),
    gravida: z.number().int().min(1).max(20),
    para: z.number().int().min(0).max(19),
    riskFactors: z.array(z.enum(RISKS)).max(20).default([]),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(),
  })
  .refine((b) => !!b.lmp !== !!b.edd, { message: 'Give the last period or the due date from an ultrasound', path: ['lmp'] })
  .refine((b) => b.para < b.gravida, { message: 'Births before this pregnancy must be fewer than all pregnancies', path: ['para'] });
const UpdateSchema = z.object({
  riskFactors: z.array(z.enum(RISKS)).max(20).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(),
  /** A due date from an ultrasound replaces the one from the period. */
  edd: z.string().regex(DAY_PATTERN).optional(),
});
const EndSchema = z.object({
  outcome: z.enum(['DELIVERED', 'DELIVERED_ELSEWHERE', 'MISCARRIAGE', 'ABORTION', 'STILLBIRTH', 'TRANSFERRED', 'LOST_TO_FOLLOW_UP']),
  endedOn: z.string().regex(DAY_PATTERN).optional(),
});
const ContactSchema = z.object({
  contactOn: z.string().regex(DAY_PATTERN).optional(),
  visitId: z.uuid().optional(),
  weightKg: z.number().min(25).max(250).nullable().optional(),
  systolicBp: int(60, 260),
  diastolicBp: int(30, 160),
  fundalHeightCm: int(5, 50),
  fetalHeartRate: int(50, 220),
  presentation: z.enum(['CEPHALIC', 'BREECH', 'TRANSVERSE']).nullable().optional(),
  urineProtein: z.enum(URINE_PROTEIN).nullable().optional(),
  hb: z.number().min(2).max(25).nullable().optional(),
  syphilis: z.enum(TEST_RESULTS).nullable().optional(),
  hiv: z.enum(TEST_RESULTS).nullable().optional(),
  hbsag: z.enum(TEST_RESULTS).nullable().optional(),
  dangerSigns: z.array(z.enum(SIGNS)).max(10).default([]),
  ifaTablets: int(0, 200),
  dewormed: z.boolean().default(false),
  note: text(1000),
});

const CLINICAL = ['ADMIN', 'DOCTOR', 'NURSE'] as const;
const FRONT = ['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'] as const;
/** The furthest a pregnancy can be when registered or followed. */
const MAX_WEEKS = 44;

type PregnancyWithContacts = Prisma.PregnancyGetPayload<{ include: { contacts: true } }>;

/** A pregnancy as the screens show it: how far along today, the next contact, each contact's alerts. */
function view(p: PregnancyWithContacts, today: string, dob: Date | null, names: Map<string, string>) {
  const lmp = day(p.lmp);
  const last = p.contacts.at(-1);
  const next = last ? day(last.nextContactOn) : null;
  const age = dob ? ageAt(dob, p.createdAt) : null;
  return {
    ...p,
    gestation: p.status === 'ACTIVE' ? gestation(lmp, today) : null,
    nextContactOn: p.status === 'ACTIVE' ? next : null,
    late: p.status === 'ACTIVE' && !!next && addDays(next, ANC_LATE_AFTER_DAYS) < today,
    risks: [...new Set([...derivedRisks(age, p.para), ...(p.riskFactors as RiskFactor[])])].map((k) => ({ key: k, label: RISK_FACTORS[k] ?? k })),
    contacts: p.contacts.map((c) => ({
      ...c,
      by: names.get(c.createdById) ?? null,
      alerts: ancAlerts({ ...c, hb: c.hb === null ? null : Number(c.hb), gaWeeks: c.gaWeeks, urineProtein: c.urineProtein as never, syphilis: c.syphilis as never, hiv: c.hiv as never, hbsag: c.hbsag as never }),
    })),
  };
}

/**
 * Antenatal care: a pregnancy registered from the last period (or an ultrasound date), its eight
 * contacts with what each found, the next contact due, and women late for theirs.
 */
@Controller()
export class AncController {
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

  private async pregnancy(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Pregnancy not found');
    const p = await this.prisma.client.pregnancy.findFirst({ where: { id, tenantId: me.tenantId }, include: { contacts: { orderBy: { contactNo: 'asc' } } } });
    if (!p) throw new NotFoundException('Pregnancy not found');
    return p;
  }

  private async names(ids: string[]) {
    const want = [...new Set(ids)];
    const users = want.length ? await this.prisma.client.user.findMany({ where: { id: { in: want } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  /** The patient's pregnancies, the current one first, each with its contacts. */
  @Get('patients/:id/pregnancies')
  @Roles(...FRONT)
  async list(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const p = await this.patient(me, id);
    const all = await this.prisma.client.pregnancy.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      include: { contacts: { orderBy: { contactNo: 'asc' } } },
    });
    const names = await this.names(all.flatMap((x) => x.contacts.map((c) => c.createdById)));
    const today = clinicDay();
    return all.map((x) => view(x, today, p.dateOfBirth, names));
  }

  /** One pregnancy with the patient, for her printed ANC card. */
  @Get('pregnancies/:id')
  @Roles(...FRONT)
  async get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const p = await this.pregnancy(me, id);
    const patient = await this.prisma.client.patient.findUniqueOrThrow({ where: { id: p.patientId }, select: { ...queuePatientSelect, address: true } });
    const names = await this.names(p.contacts.map((c) => c.createdById));
    return { ...view(p, clinicDay(), patient.dateOfBirth, names), patient };
  }

  /** Registers a pregnancy: one at a time per woman, from the last period or an ultrasound due date. */
  @Post('patients/:id/pregnancies')
  @Roles('DOCTOR', 'NURSE')
  async register(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>) {
    const p = await this.patient(me, id);
    await assertNotMerged(this.prisma.client, p);
    if (p.sex !== 'FEMALE') throw new ConflictException('Antenatal care is for women');
    const today = clinicDay();
    const lmp = body.lmp ?? lmpFromEdd(body.edd!);
    const ga = gestation(lmp, today);
    if (ga.totalDays < 0) throw new ConflictException('The last period is in the future');
    if (ga.weeks >= MAX_WEEKS) throw new ConflictException(`That is ${ga.weeks} weeks: check the date`);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${id} FOR UPDATE`;
      const open = await tx.pregnancy.findFirst({ where: { patientId: id, status: 'ACTIVE' } });
      if (open) throw new ConflictException('She already has a pregnancy being followed: end it first');
      const created = await tx.pregnancy.create({
        data: {
          tenantId: me.tenantId,
          patientId: id,
          lmp: asDate(lmp),
          edd: asDate(body.edd ?? eddFrom(lmp)),
          eddSource: body.edd ? 'ULTRASOUND' : 'LMP',
          gravida: body.gravida,
          para: body.para,
          riskFactors: [...new Set(body.riskFactors)],
          bloodGroup: body.bloodGroup ?? null,
          createdById: me.sub,
        },
      });
      await this.audit.log(me, 'anc.register', 'Patient', id, { pregnancy: created.id }, tx);
      return created;
    });
  }

  /** Risk factors and blood group as they become known; an ultrasound due date. */
  @Patch('pregnancies/:id')
  @Roles('DOCTOR', 'NURSE')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>) {
    const p = await this.pregnancy(me, id);
    if (p.status !== 'ACTIVE') throw new ConflictException('This pregnancy has ended');
    const updated = await this.prisma.client.pregnancy.update({
      where: { id },
      data: {
        ...(body.riskFactors && { riskFactors: [...new Set(body.riskFactors)] }),
        ...(body.bloodGroup !== undefined && { bloodGroup: body.bloodGroup }),
        ...(body.edd && { edd: asDate(body.edd), lmp: asDate(lmpFromEdd(body.edd)), eddSource: 'ULTRASOUND' }),
      },
    });
    await this.audit.log(me, 'anc.update', 'Patient', p.patientId, { pregnancy: id, fields: Object.keys(body) });
    return updated;
  }

  /** The end of the pregnancy's follow-up: delivered (here or elsewhere), lost, transferred. */
  @Post('pregnancies/:id/end')
  @Roles('DOCTOR', 'NURSE')
  async end(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(EndSchema)) body: z.infer<typeof EndSchema>) {
    const p = await this.pregnancy(me, id);
    if (p.status !== 'ACTIVE') throw new ConflictException('This pregnancy has already ended');
    const endedOn = body.endedOn ?? clinicDay();
    if (endedOn > clinicDay() || endedOn < day(p.lmp)) throw new ConflictException('Check the date');
    const delivered = body.outcome === 'DELIVERED' || body.outcome === 'DELIVERED_ELSEWHERE';
    const updated = await this.prisma.client.pregnancy.update({ where: { id }, data: { status: delivered ? 'DELIVERED' : 'ENDED', outcome: body.outcome, endedOn: asDate(endedOn) } });
    await this.audit.log(me, 'anc.end', 'Patient', p.patientId, { pregnancy: id, outcome: body.outcome });
    return updated;
  }

  /**
   * Records an antenatal contact: its number and the weeks are worked out, the next contact is
   * booked on the 8-contact schedule, and the findings' alerts come back with it.
   */
  @Post('pregnancies/:id/contacts')
  @Roles('DOCTOR', 'NURSE')
  async contact(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ContactSchema)) body: z.infer<typeof ContactSchema>) {
    const p = await this.pregnancy(me, id);
    if (p.status !== 'ACTIVE') throw new ConflictException('This pregnancy has ended');
    const contactOn = body.contactOn ?? clinicDay();
    if (contactOn > clinicDay()) throw new ConflictException('The date is in the future');
    const ga = gestation(day(p.lmp), contactOn);
    if (ga.totalDays < 0) throw new ConflictException('The date is before the last period');
    if (p.contacts.some((c) => day(c.contactOn) === contactOn)) throw new ConflictException('A contact is already recorded on that day');
    if (body.visitId) {
      const v = await this.prisma.client.visit.findFirst({ where: { id: body.visitId, tenantId: me.tenantId, patientId: p.patientId }, select: { id: true } });
      if (!v) throw new NotFoundException('Visit not found');
    }
    const { contactOn: _, ...rest } = body;
    const created = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Pregnancy" WHERE "id" = ${id} FOR UPDATE`;
      const count = await tx.ancContact.count({ where: { pregnancyId: id } });
      return tx.ancContact.create({
        data: {
          ...rest,
          tenantId: me.tenantId,
          pregnancyId: id,
          contactNo: count + 1,
          contactOn: asDate(contactOn),
          gaWeeks: ga.weeks,
          gaDays: ga.days,
          nextContactOn: asDate(nextContactOn(day(p.lmp), ga.weeks)),
          createdById: me.sub,
        },
      });
    });
    // Field names only: the audit log is not a second copy of the record.
    await this.audit.log(me, 'anc.contact', 'Patient', p.patientId, { pregnancy: id, contactNo: created.contactNo });
    return { ...created, alerts: ancAlerts({ ...body, gaWeeks: ga.weeks }) };
  }

  /**
   * Women followed in antenatal care: late for their next contact (more than a week past it), due
   * this week, and those whose due date is within two weeks (birth preparedness).
   */
  @Get('anc/due')
  @Roles(...FRONT)
  async due(@CurrentUser() me: AuthUser) {
    const today = clinicDay();
    const active = await this.prisma.client.pregnancy.findMany({
      where: { tenantId: me.tenantId, status: 'ACTIVE', patient: { mergedIntoId: null } },
      include: { patient: { select: queuePatientSelect }, contacts: { orderBy: { contactNo: 'desc' }, take: 1 } },
    });
    const rows = active.map((p) => {
      const last = p.contacts[0];
      // Registered without a contact yet: the first is due now.
      const next = last ? day(last.nextContactOn) : day(p.createdAt);
      const ga = gestation(day(p.lmp), today);
      return {
        pregnancyId: p.id,
        patient: p.patient,
        gestation: ga,
        edd: day(p.edd),
        contacts: last?.contactNo ?? 0,
        nextContactOn: next,
        daysLate: Math.max(0, Math.round((Date.parse(today) - Date.parse(next)) / 86_400_000)),
        late: addDays(next, ANC_LATE_AFTER_DAYS) < today,
        dueThisWeek: next >= today && next <= addDays(today, 7),
        deliverySoon: day(p.edd) <= addDays(today, 14),
      };
    });
    return rows.filter((r) => r.late || r.dueThisWeek || r.deliverySoon || r.nextContactOn <= today).sort((a, b) => Number(b.late) - Number(a.late) || b.daysLate - a.daysLate);
  }
}

/** The month's antenatal tally for the MoH report. */
export async function ancTally(db: Pick<Prisma.TransactionClient, 'ancContact'>, tenantId: string, start: string, end: string) {
  const contacts = await db.ancContact.findMany({
    where: { tenantId, contactOn: { gte: asDate(start), lt: asDate(end) } },
    select: { contactNo: true, gaWeeks: true, syphilis: true, hiv: true, hbsag: true, hb: true, ifaTablets: true },
  });
  const first = contacts.filter((c) => c.contactNo === 1);
  const tested = (k: 'syphilis' | 'hiv' | 'hbsag') => contacts.filter((c) => c[k] === 'POSITIVE' || c[k] === 'NEGATIVE');
  return {
    contacts: contacts.length,
    firstContacts: first.length,
    firstBy12Weeks: first.filter((c) => c.gaWeeks <= 12).length,
    firstBefore16Weeks: first.filter((c) => c.gaWeeks < 16).length,
    fourthContacts: contacts.filter((c) => c.contactNo === 4).length,
    eighthContacts: contacts.filter((c) => c.contactNo === 8).length,
    syphilisTested: tested('syphilis').length,
    syphilisPositive: contacts.filter((c) => c.syphilis === 'POSITIVE').length,
    hivTested: tested('hiv').length,
    hivPositive: contacts.filter((c) => c.hiv === 'POSITIVE').length,
    hbsagTested: tested('hbsag').length,
    anaemic: contacts.filter((c) => c.hb !== null && Number(c.hb) < 11).length,
    ifaGiven: contacts.filter((c) => (c.ifaTablets ?? 0) > 0).length,
  };
}

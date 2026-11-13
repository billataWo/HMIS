import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { DAY_PATTERN } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import { ICD11_CODE } from './icd11-common.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();
const day = z
  .string()
  .regex(DAY_PATTERN, 'Use a date like 2024-05-01')
  .transform((d) => new Date(`${d}T00:00:00Z`))
  .nullable()
  .optional();

const ProblemSchema = z.object({
  icd11Code: z.string().trim().toUpperCase().regex(ICD11_CODE, 'Not a valid ICD-11 code').nullable().optional(),
  label: z.string().trim().min(2, 'Name the condition').max(300),
  since: day,
  note: text(500),
});
const ProblemUpdateSchema = z.object({ status: z.enum(['ACTIVE', 'RESOLVED']).optional(), since: day, note: text(500) });
const AddendumSchema = z.object({ text: z.string().trim().min(3, 'Write the addendum').max(5000) });

/**
 * The patient's record beyond one visit: their problem list, how their vitals have changed, notes
 * added to a visit afterwards (addenda), and what the patient takes home (the visit summary).
 */
@Controller()
export class ClinicalRecordController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async patient(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Patient not found');
    const p = await this.prisma.client.patient.findFirst({ where: { id, tenantId: me.tenantId }, select: { id: true } });
    if (!p) throw new NotFoundException('Patient not found');
    return p;
  }

  private async visit(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const v = await this.prisma.client.visit.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!v) throw new NotFoundException('Visit not found');
    return v;
  }

  /** Active problems first (oldest first), then resolved ones. */
  @Get('patients/:id/problems')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async problems(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.patient(me, id);
    return this.prisma.client.patientProblem.findMany({ where: { patientId: id }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
  }

  @Post('patients/:id/problems')
  @Roles('DOCTOR')
  async addProblem(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ProblemSchema)) body: z.infer<typeof ProblemSchema>) {
    await this.patient(me, id);
    const dup = await this.prisma.client.patientProblem.findFirst({
      where: {
        patientId: id,
        status: 'ACTIVE',
        OR: [{ label: { equals: body.label, mode: 'insensitive' } }, ...(body.icd11Code ? [{ icd11Code: body.icd11Code }] : [])],
      },
    });
    if (dup) throw new ConflictException(`${dup.label} is already on the problem list`);
    const p = await this.prisma.client.patientProblem.create({ data: { ...body, tenantId: me.tenantId, patientId: id, createdById: me.sub } });
    await this.audit.log(me, 'problem.add', 'Patient', id, { code: body.icd11Code });
    return p;
  }

  /** Resolves a problem (or brings it back), or corrects its date or note. */
  @Patch('problems/:id')
  @Roles('DOCTOR')
  async updateProblem(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ProblemUpdateSchema)) body: z.infer<typeof ProblemUpdateSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Problem not found');
    const p = await this.prisma.client.patientProblem.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!p) throw new NotFoundException('Problem not found');
    const updated = await this.prisma.client.patientProblem.update({
      where: { id },
      data: { ...body, ...(body.status && { resolvedAt: body.status === 'RESOLVED' ? new Date() : null }) },
    });
    await this.audit.log(me, 'problem.update', 'Patient', p.patientId, { problem: id, fields: Object.keys(body) });
    return updated;
  }

  /** The vitals of the patient's last visits, newest first: blood pressure and weight over time. */
  @Get('patients/:id/vitals')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async vitals(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.patient(me, id);
    return this.prisma.client.visit.findMany({
      where: {
        patientId: id,
        kind: 'OPD',
        status: { not: 'CANCELLED' },
        OR: [{ systolicBp: { not: null } }, { weightKg: { not: null } }, { pulse: { not: null } }, { temperatureC: { not: null } }],
      },
      orderBy: { checkedInAt: 'desc' },
      take: 12,
      select: { id: true, checkedInAt: true, systolicBp: true, diastolicBp: true, pulse: true, temperatureC: true, spo2: true, weightKg: true, heightCm: true, muacMm: true },
    });
  }

  /**
   * A note added to a visit afterwards: signed and timed, never edited, also once the visit is
   * closed (a result reviewed, a phone call, a correction of the record).
   */
  @Post('visits/:id/addenda')
  @Roles('DOCTOR', 'NURSE')
  async addAddendum(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(AddendumSchema)) body: z.infer<typeof AddendumSchema>) {
    const v = await this.visit(me, id);
    if (v.kind !== 'OPD') throw new ConflictException('Addenda belong to consultations');
    if (v.status === 'CANCELLED') throw new ConflictException('This visit was cancelled');
    const a = await this.prisma.client.visitAddendum.create({ data: { tenantId: me.tenantId, visitId: id, text: body.text, authorId: me.sub } });
    // The fact of it, not its content: the audit log is not a second copy of the record.
    await this.audit.log(me, 'visit.addendum', 'Visit', id, { addendum: a.id });
    return { ...a, author: { id: me.sub, fullName: me.name ?? null, role: me.role } };
  }

  /**
   * What the patient takes home: the diagnoses, the medicines with how to take them, the tests and
   * their results, the next appointment and the doctor's advice.
   */
  @Get('visits/:id/summary')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async summary(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const v = await this.visit(me, id);
    if (v.kind !== 'OPD') throw new ConflictException('A visit summary is for consultations');
    const visit = await this.prisma.client.visit.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        checkedInAt: true,
        patientAdvice: true,
        patient: { select: queuePatientSelect },
        doctor: { select: { fullName: true } },
        tenant: { select: { name: true, nameAm: true, phone: true, address: true } },
        diagnoses: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }], select: { icd11Code: true, label: true, isPrimary: true } },
        prescriptions: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            items: {
              select: {
                dose: true,
                frequency: true,
                durationDays: true,
                quantity: true,
                instructions: true,
                drug: { select: { genericName: true, strength: true, form: true, unit: true } },
              },
            },
          },
        },
        labOrders: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { orderedAt: 'asc' },
          select: { status: true, resultValue: true, resultFlag: true, labTest: { select: { name: true, unit: true } } },
        },
      },
    });
    const next = await this.prisma.client.appointment.findFirst({
      where: { tenantId: me.tenantId, patientId: v.patientId, status: 'BOOKED', scheduledAt: { gt: v.checkedInAt } },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true, reason: true, doctor: { select: { fullName: true } } },
    });
    await this.audit.log(me, 'visit.summary', 'Visit', id);
    return { ...visit, medicines: visit.prescriptions.flatMap((p) => p.items), prescriptions: undefined, nextAppointment: next };
  }
}

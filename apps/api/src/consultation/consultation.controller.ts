import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import { ICD11_CODE, searchIcd } from './icd11-common.js';

const num = (min: number, max: number, int = false) => {
  const n = int ? z.number().int() : z.number();
  return n.min(min, `Must be at least ${min}`).max(max, `Must be at most ${max}`).nullable().optional();
};
const note = z.string().trim().max(10_000).nullable().optional();

const VITALS = ['temperatureC', 'pulse', 'systolicBp', 'diastolicBp', 'respRate', 'spo2', 'weightKg', 'heightCm'] as const;
const NOTES = ['chiefComplaint', 'history', 'examination', 'plan'] as const;

const UpdateSchema = z
  .object({
    temperatureC: num(25, 45),
    pulse: num(20, 250, true),
    systolicBp: num(50, 300, true),
    diastolicBp: num(20, 200, true),
    respRate: num(5, 80, true),
    spo2: num(50, 100, true),
    weightKg: num(0.3, 300),
    heightCm: num(20, 250),
    chiefComplaint: note,
    history: note,
    examination: note,
    plan: note,
  })
  .refine((v) => v.systolicBp == null || v.diastolicBp == null || v.systolicBp > v.diastolicBp, {
    message: 'Systolic must be higher than diastolic',
    path: ['diastolicBp'],
  });

const DiagnosisSchema = z.object({
  icd11Code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(ICD11_CODE, 'Not a valid ICD-11 code (for example CA40 or ME84.2)'),
  label: z.string().trim().min(2).max(300),
  isPrimary: z.boolean().default(false),
});

const visitInclude = {
  patient: { select: queuePatientSelect },
  doctor: { select: { id: true, fullName: true } },
  diagnoses: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.VisitInclude;

const isClosed = (status: string) => status === 'COMPLETED' || status === 'CANCELLED';

@Controller()
@Roles('ADMIN', 'DOCTOR', 'NURSE')
export class ConsultationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async findVisit(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const visit = await this.prisma.client.visit.findFirst({ where: { id, tenantId: me.tenantId }, include: visitInclude });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  /** A visit with the patient's previous visits for context. */
  @Get('visits/:id')
  async get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const visit = await this.findVisit(me, id);
    const previous = await this.prisma.client.visit.findMany({
      where: { tenantId: me.tenantId, patientId: visit.patientId, id: { not: id }, status: 'COMPLETED', checkedInAt: { lt: visit.checkedInAt } },
      orderBy: { checkedInAt: 'desc' },
      take: 5,
      select: {
        id: true,
        checkedInAt: true,
        chiefComplaint: true,
        plan: true,
        systolicBp: true,
        diastolicBp: true,
        weightKg: true,
        doctor: { select: { fullName: true } },
        diagnoses: { select: { icd11Code: true, label: true, isPrimary: true } },
      },
    });
    return { ...visit, previous };
  }

  /**
   * Saves vitals and notes. Doctors may edit everything; nurses record vitals and the chief
   * complaint (triage). Finished visits are part of the medical record and can no longer change.
   */
  @Patch('visits/:id')
  @Roles('DOCTOR', 'NURSE')
  async update(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>,
  ) {
    const visit = await this.findVisit(me, id);
    if (isClosed(visit.status)) throw new ConflictException('This visit is closed and can no longer be edited');

    const fields = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    if (me.role === 'NURSE') {
      const allowed: string[] = [...VITALS, 'chiefComplaint'];
      const blocked = fields.filter((f) => !allowed.includes(f));
      if (blocked.length) throw new ForbiddenException(`Nurses cannot edit: ${blocked.join(', ')}`);
    }

    const updated = await this.prisma.client.visit.update({
      where: { id },
      data: Object.fromEntries(fields.map((f) => [f, body[f as keyof typeof body]])),
      include: visitInclude,
    });
    // Field names only: the audit log must not become a second copy of clinical content.
    await this.audit.log(me, 'visit.update', 'Visit', id, { fields });
    return updated;
  }

  @Post('visits/:id/diagnoses')
  @Roles('DOCTOR')
  async addDiagnosis(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(DiagnosisSchema)) body: z.infer<typeof DiagnosisSchema>,
  ) {
    const visit = await this.findVisit(me, id);
    if (isClosed(visit.status)) throw new ConflictException('This visit is closed and can no longer be edited');
    if (visit.diagnoses.some((d) => d.icd11Code === body.icd11Code)) {
      throw new ConflictException('This diagnosis is already recorded for the visit');
    }

    // The first diagnosis is primary by default; there is only ever one primary.
    const isPrimary = body.isPrimary || visit.diagnoses.length === 0;
    const diagnosis = await this.prisma.client.$transaction(async (tx) => {
      if (isPrimary) await tx.diagnosis.updateMany({ where: { visitId: id }, data: { isPrimary: false } });
      return tx.diagnosis.create({ data: { visitId: id, icd11Code: body.icd11Code, label: body.label, isPrimary } });
    });
    await this.audit.log(me, 'diagnosis.add', 'Visit', id, { icd11Code: body.icd11Code });
    return diagnosis;
  }

  @Delete('visits/:id/diagnoses/:diagnosisId')
  @Roles('DOCTOR')
  @HttpCode(204)
  async removeDiagnosis(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('diagnosisId') diagnosisId: string) {
    const visit = await this.findVisit(me, id);
    if (isClosed(visit.status)) throw new ConflictException('This visit is closed and can no longer be edited');
    const diagnosis = visit.diagnoses.find((d) => d.id === diagnosisId);
    if (!diagnosis) throw new NotFoundException('Diagnosis not found');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.diagnosis.delete({ where: { id: diagnosisId } });
      // Keep a primary diagnosis if any remain.
      if (diagnosis.isPrimary) {
        const next = visit.diagnoses.find((d) => d.id !== diagnosisId);
        if (next) await tx.diagnosis.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
    await this.audit.log(me, 'diagnosis.remove', 'Visit', id, { icd11Code: diagnosis.icd11Code });
  }

  @Get('icd11')
  icd(@Query('q') q = '') {
    return searchIcd(String(q));
  }
}

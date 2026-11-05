import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { normalizePhone } from '../common/phone.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const optionalText = z
  .string()
  .trim()
  .transform((s) => s || undefined)
  .optional();

const CreatePatientSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required'),
    fatherName: z.string().trim().min(1, "Father's name is required"),
    grandfather: optionalText,
    firstNameAm: optionalText,
    fatherNameAm: optionalText,
    sex: z.enum(['MALE', 'FEMALE']),
    dateOfBirth: z.iso.date().optional(),
    ageYears: z.coerce.number().int().min(0).max(130).optional(), // when the exact birth date is unknown
    phone: optionalText.transform((p) => (p ? normalizePhone(p) : undefined)),
    address: optionalText,
    relativeId: z.uuid().optional(), // existing patient in the same household
    allergies: z.array(z.string().trim().min(1)).default([]),
  })
  .refine((p) => !(p.dateOfBirth && p.ageYears !== undefined), {
    message: 'Give either a date of birth or an age, not both',
    path: ['ageYears'],
  });

const SearchSchema = z.object({
  q: z.string().trim().default(''),
  take: z.coerce.number().int().min(1).max(100).default(30),
});

export function formatMrn(n: number) {
  return `MRN-${String(n).padStart(6, '0')}`;
}

@Controller('patients')
export class PatientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Search by MRN, phone, or any part of the name (English or Amharic). Every word must match. */
  @Get()
  search(@CurrentUser() me: AuthUser, @Query(new ZodPipe(SearchSchema)) { q, take }: z.infer<typeof SearchSchema>) {
    const words = q.split(/\s+/).filter(Boolean);
    const where: Prisma.PatientWhereInput = {
      tenantId: me.tenantId,
      AND: words.map((w) => {
        const ci = { contains: w, mode: 'insensitive' as const };
        return {
          OR: [
            { mrn: ci },
            { phone: { contains: normalizePhone(w) } },
            { firstName: ci },
            { fatherName: ci },
            { grandfather: ci },
            { firstNameAm: { contains: w } },
            { fatherNameAm: { contains: w } },
          ],
        };
      }),
    };
    return this.prisma.client.patient.findMany({ where, take, orderBy: { createdAt: 'desc' } });
  }

  @Get(':id')
  async get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Patient not found');
    // Only clinical staff see what happened in a visit; others see that it happened.
    const clinical = me.role === 'ADMIN' || me.role === 'DOCTOR' || me.role === 'NURSE';
    const patient = await this.prisma.client.patient.findFirst({
      where: { id, tenantId: me.tenantId },
      include: {
        visits: {
          orderBy: { checkedInAt: 'desc' },
          take: 20,
          select: {
            id: true,
            checkedInAt: true,
            status: true,
            queueNumber: true,
            doctor: { select: { fullName: true } },
            ...(clinical && { chiefComplaint: true, diagnoses: true }),
          },
        },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const family = patient.familyId
      ? await this.prisma.client.patient.findMany({
          where: { tenantId: me.tenantId, familyId: patient.familyId, NOT: { id } },
          select: { id: true, mrn: true, firstName: true, fatherName: true, sex: true, dateOfBirth: true },
        })
      : [];
    return { ...patient, family };
  }

  @Post()
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  async create(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(CreatePatientSchema)) body: z.infer<typeof CreatePatientSchema>,
  ) {
    const { ageYears, dateOfBirth, relativeId, ...rest } = body;
    const dob = dateOfBirth
      ? new Date(dateOfBirth)
      : ageYears !== undefined
        ? new Date(Date.UTC(new Date().getUTCFullYear() - ageYears, 0, 1))
        : undefined;

    return this.prisma.client.$transaction(async (tx) => {
      // The family group id is the id of whichever member started the group.
      let familyId: string | undefined;
      if (relativeId) {
        const relative = await tx.patient.findFirst({ where: { id: relativeId, tenantId: me.tenantId } });
        if (!relative) throw new NotFoundException('Family member not found');
        familyId = relative.familyId ?? relative.id;
        if (!relative.familyId) await tx.patient.update({ where: { id: relative.id }, data: { familyId } });
      }

      // Atomic increment: two receptionists registering at once can never get the same MRN.
      const { nextMrn } = await tx.tenant.update({
        where: { id: me.tenantId },
        data: { nextMrn: { increment: 1 } },
        select: { nextMrn: true },
      });

      const patient = await tx.patient.create({
        data: {
          ...rest,
          tenantId: me.tenantId,
          mrn: formatMrn(nextMrn - 1),
          dateOfBirth: dob,
          familyId,
        },
      });

      await this.audit.log(me, 'patient.create', 'Patient', patient.id, { mrn: patient.mrn }, tx);
      return patient;
    });
  }
}

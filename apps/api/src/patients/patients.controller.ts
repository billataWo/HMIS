import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
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
    confirmDuplicate: z.boolean().default(false), // registering although a similar record exists
  })
  .refine((p) => !(p.dateOfBirth && p.ageYears !== undefined), {
    message: 'Give either a date of birth or an age, not both',
    path: ['ageYears'],
  });

/** MRN of the one shared record per clinic for pharmacy customers who don't give a name. */
export const WALK_IN_MRN = 'WALK-IN';

/** Empty string clears the field. */
const clearableText = z
  .string()
  .trim()
  .max(300)
  .transform((s) => s || null)
  .optional();

const UpdatePatientSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').optional(),
    fatherName: z.string().trim().min(1, "Father's name is required").optional(),
    grandfather: clearableText,
    firstNameAm: clearableText,
    fatherNameAm: clearableText,
    sex: z.enum(['MALE', 'FEMALE']).optional(),
    dateOfBirth: z.iso.date().nullable().optional(),
    ageYears: z.coerce.number().int().min(0).max(130).optional(),
    phone: clearableText.transform((p) => (p ? normalizePhone(p) : p)),
    address: clearableText,
    allergies: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .refine((p) => !(p.dateOfBirth && p.ageYears !== undefined), {
    message: 'Give either a date of birth or an age, not both',
    path: ['ageYears'],
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Nothing to change' });

const FRONT_DESK = ['ADMIN', 'RECEPTIONIST', 'NURSE'];

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
      mrn: { not: WALK_IN_MRN }, // the shared record for unnamed pharmacy customers
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
            kind: true, // pharmacy counter sales are listed but are not consultations
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

  /**
   * Registration is a front-desk job, done together with check-in and the consultation fee:
   * receptionists, nurses (who cover the desk in small clinics) and admins. Doctors may too when
   * the admin turns on "doctors can register patients" (a clinic with no receptionist). Cashiers,
   * the lab and the pharmacy search and view patients but never create records, which keeps one
   * card per patient instead of duplicates made from other desks.
   */
  @Post()
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  async create(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(CreatePatientSchema)) body: z.infer<typeof CreatePatientSchema>,
  ) {
    if (me.role === 'DOCTOR') {
      const { doctorsCanRegister } = await this.prisma.client.tenant.findUniqueOrThrow({
        where: { id: me.tenantId },
        select: { doctorsCanRegister: true },
      });
      if (!doctorsCanRegister) {
        throw new ForbiddenException('Patients are registered at reception. An admin can let doctors register them in Settings.');
      }
    }
    const { ageYears, dateOfBirth, relativeId, confirmDuplicate, ...rest } = body;

    // One card per patient: offer the existing record before creating a second one. Same phone,
    // or same first and father's name; family members often share a parent's phone, so for them
    // only the name counts.
    if (!confirmDuplicate) {
      const same = { equals: undefined as string | undefined, mode: 'insensitive' as const };
      const duplicates = await this.prisma.client.patient.findMany({
        where: {
          tenantId: me.tenantId,
          mrn: { not: WALK_IN_MRN },
          OR: [
            ...(rest.phone && !relativeId ? [{ phone: rest.phone }] : []),
            { firstName: { ...same, equals: rest.firstName }, fatherName: { ...same, equals: rest.fatherName } },
          ],
        },
        take: 5,
        select: { id: true, mrn: true, firstName: true, fatherName: true, grandfather: true, sex: true, dateOfBirth: true, phone: true },
      });
      if (duplicates.length) {
        throw new ConflictException({ message: 'This patient may already be registered', duplicates });
      }
    }

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

  /**
   * Corrects a patient's details. Whoever may register patients may change everything. Doctors
   * may always update allergies, because an allergy found during a consultation must reach the
   * prescribing checks straight away.
   */
  @Patch(':id')
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(UpdatePatientSchema)) body: z.infer<typeof UpdatePatientSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Patient not found');
    const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);

    if (!FRONT_DESK.includes(me.role)) {
      const { doctorsCanRegister } = await this.prisma.client.tenant.findUniqueOrThrow({
        where: { id: me.tenantId },
        select: { doctorsCanRegister: true },
      });
      if (!doctorsCanRegister && changed.some((k) => k !== 'allergies')) {
        throw new ForbiddenException('Doctors can update allergies; other details are corrected at reception');
      }
    }

    const { ageYears, dateOfBirth, ...rest } = body;
    const data: Prisma.PatientUpdateInput = { ...rest };
    if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    if (ageYears !== undefined) data.dateOfBirth = new Date(Date.UTC(new Date().getUTCFullYear() - ageYears, 0, 1));
    if (body.allergies) data.allergies = [...new Set(body.allergies)];

    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.patient.findFirst({ where: { id, tenantId: me.tenantId } });
      if (!existing) throw new NotFoundException('Patient not found');
      const patient = await tx.patient.update({ where: { id }, data });
      // Which fields changed, never their content.
      await this.audit.log(me, 'patient.update', 'Patient', id, { mrn: patient.mrn, fields: changed }, tx);
      return patient;
    });
  }
}

import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles, AllStaff } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { normalizePhone } from '../common/phone.js';
import { dobFromAge, ethiopianToGregorianDay } from '../common/age.js';
import { clinicDay, DAY_PATTERN } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { usableCoverages } from '../billing/coverage.js';
import { balanceView, patientBalances } from '../billing/balance.js';

/** Ethiopia's regions and city administrations, for the structured address. */
export const REGIONS = [
  'Addis Ababa',
  'Afar',
  'Amhara',
  'Benishangul-Gumuz',
  'Central Ethiopia',
  'Dire Dawa',
  'Gambela',
  'Harari',
  'Oromia',
  'Sidama',
  'Somali',
  'South Ethiopia',
  'South West Ethiopia',
  'Tigray',
] as const;

/** A Fayda number with its spaces and dashes taken out: 12 digits (FIN) or 16 (FAN). */
const nationalIdField = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .refine((s) => s === '' || /^(\d{12}|\d{16})$/.test(s), 'A Fayda number has 12 or 16 digits');

/** The record beyond the name: structured address, next of kin and national ID. */
function recordFields<T extends z.ZodType>(text: T) {
  return {
    // Empty: none (or cleared).
    region: z.preprocess((v) => (v === '' ? null : v), z.enum(REGIONS).nullable().optional()),
    zone: text,
    woreda: text,
    kebele: text,
    houseNo: text,
    nextOfKinName: text,
    nextOfKinRelation: text,
    nextOfKinPhone: text,
  };
}

const optionalText = z
  .string()
  .trim()
  .transform((s) => s || undefined)
  .optional();

/** How the birth date was given: a date (either calendar) or an age; at most one. */
const birthFields = {
  dateOfBirth: z.iso.date().optional(),
  /** In the Ethiopian calendar (month 13 is Pagume); converted here. */
  dateOfBirthEc: z.string().regex(DAY_PATTERN, 'Use day, month and year').optional(),
  ageYears: z.coerce.number().int().min(0).max(130).optional(), // when the exact birth date is unknown
  /** With ageYears or alone: babies and young children, whose age in months matters. */
  ageMonths: z.coerce.number().int().min(0).max(11).optional(),
};
type Birth = { dateOfBirth?: string | null; dateOfBirthEc?: string; ageYears?: number; ageMonths?: number };

/** One way of giving the birth date, a real Ethiopian date, and not in the future. */
function checkBirth(b: Birth, ctx: z.RefinementCtx) {
  const ways = [b.dateOfBirth, b.dateOfBirthEc, b.ageYears ?? b.ageMonths].filter((x) => x !== undefined && x !== null).length;
  if (ways > 1) ctx.addIssue({ code: 'custom', message: 'Give either a date of birth or an age, not both', path: ['ageYears'] });
  const ec = b.dateOfBirthEc ? ethiopianToGregorianDay(b.dateOfBirthEc) : undefined;
  if (ec === null) ctx.addIssue({ code: 'custom', message: 'There is no such day in the Ethiopian calendar', path: ['dateOfBirthEc'] });
  const day = ec ?? b.dateOfBirth;
  if (day && day > clinicDay()) ctx.addIssue({ code: 'custom', message: 'The date of birth is in the future', path: [b.dateOfBirthEc ? 'dateOfBirthEc' : 'dateOfBirth'] });
}

/** The birth date to store, and whether it was worked out from an age. */
function birthOf(b: Birth): { dateOfBirth?: Date | null; dobEstimated?: boolean } {
  if (b.dateOfBirthEc) return { dateOfBirth: new Date(ethiopianToGregorianDay(b.dateOfBirthEc)!), dobEstimated: false };
  if (b.dateOfBirth) return { dateOfBirth: new Date(b.dateOfBirth), dobEstimated: false };
  if (b.dateOfBirth === null) return { dateOfBirth: null, dobEstimated: false };
  if (b.ageYears !== undefined || b.ageMonths !== undefined) return { dateOfBirth: dobFromAge(b.ageYears ?? 0, b.ageMonths ?? 0, clinicDay()), dobEstimated: true };
  return {};
}

const CreatePatientSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required'),
    fatherName: z.string().trim().min(1, "Father's name is required"),
    grandfather: optionalText,
    firstNameAm: optionalText,
    fatherNameAm: optionalText,
    sex: z.enum(['MALE', 'FEMALE']),
    ...birthFields,
    phone: optionalText.transform((p) => (p ? normalizePhone(p) : undefined)),
    address: optionalText,
    ...recordFields(optionalText),
    nationalId: nationalIdField.transform((s) => s || undefined).optional(),
    relativeId: z.uuid().optional(), // existing patient in the same household
    allergies: z.array(z.string().trim().min(1)).default([]),
    confirmDuplicate: z.boolean().default(false), // registering although a similar record exists
  })
  .superRefine(checkBirth);

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
    ...birthFields,
    dateOfBirth: z.iso.date().nullable().optional(),
    phone: clearableText.transform((p) => (p ? normalizePhone(p) : p)),
    address: clearableText,
    ...recordFields(clearableText),
    nationalId: nationalIdField.transform((s) => s || null).optional(),
    allergies: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .superRefine(checkBirth)
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Nothing to change' });

const FRONT_DESK = ['ADMIN', 'RECEPTIONIST', 'NURSE'];

const MergeSchema = z.object({ duplicateId: z.uuid() });

/** Details a merge copies from the duplicate when the kept record has none. */
const FILL = ['grandfather', 'firstNameAm', 'fatherNameAm', 'phone', 'address', 'region', 'zone', 'woreda', 'kebele', 'houseNo', 'nextOfKinName', 'nextOfKinRelation', 'nextOfKinPhone'] as const;

const SearchSchema = z.object({
  q: z.string().trim().default(''),
  take: z.coerce.number().int().min(1).max(100).default(30),
  /** "1": with what each patient owes from earlier visits (the front desk and cashier only). */
  balance: z.enum(['1']).optional(),
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
  @AllStaff()
  @Get()
  async search(@CurrentUser() me: AuthUser, @Query(new ZodPipe(SearchSchema)) { q, take, balance }: z.infer<typeof SearchSchema>) {
    const words = q.split(/\s+/).filter(Boolean);
    const where: Prisma.PatientWhereInput = {
      tenantId: me.tenantId,
      mrn: { not: WALK_IN_MRN }, // the shared record for unnamed pharmacy customers
      mergedIntoId: null,
      AND: words.map((w) => {
        const ci = { contains: w, mode: 'insensitive' as const };
        const digits = w.replace(/\D/g, '');
        return {
          OR: [
            { mrn: ci },
            // The MRN on the card of a record merged into this one.
            { mergedFrom: { some: { mrn: ci } } },
            ...(digits.length >= 4 && digits.length === w.replace(/[\s-]/g, '').length ? [{ nationalId: { contains: digits } }] : []),
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
    // With the coverages they can use today, so the front desk can check them in on their payer.
    const patients = await this.prisma.client.patient.findMany({ where, take, orderBy: { createdAt: 'desc' }, include: { coverages: usableCoverages() } });
    if (!balance || ![...FRONT_DESK, 'CASHIER'].includes(me.role)) return patients;
    const owed = await patientBalances(this.prisma.client, me.tenantId, patients.map((p) => p.id));
    return patients.map((p) => ({ ...p, balance: balanceView(owed.get(p.id)) }));
  }

  @AllStaff()
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
    const { ageYears, ageMonths, dateOfBirth, dateOfBirthEc, relativeId, confirmDuplicate, ...rest } = body;

    // One record per national ID, whatever else matches.
    if (rest.nationalId) {
      const same = await this.prisma.client.patient.findFirst({ where: { tenantId: me.tenantId, nationalId: rest.nationalId }, select: { mrn: true } });
      if (same) throw new ConflictException(`This national ID is already registered, as ${same.mrn}`);
    }

    // One card per patient: offer the existing record before creating a second one. Same phone,
    // or same first and father's name; family members often share a parent's phone, so for them
    // only the name counts.
    if (!confirmDuplicate) {
      const same = { equals: undefined as string | undefined, mode: 'insensitive' as const };
      const duplicates = await this.prisma.client.patient.findMany({
        where: {
          tenantId: me.tenantId,
          mrn: { not: WALK_IN_MRN },
          mergedIntoId: null,
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

    const birth = birthOf({ ageYears, ageMonths, dateOfBirth, dateOfBirthEc });

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
          dateOfBirth: birth.dateOfBirth ?? undefined,
          dobEstimated: birth.dobEstimated ?? false,
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

    const { ageYears, ageMonths, dateOfBirth, dateOfBirthEc, ...rest } = body;
    const data: Prisma.PatientUpdateInput = { ...rest, ...birthOf({ ageYears, ageMonths, dateOfBirth, dateOfBirthEc }) };
    if (body.allergies) data.allergies = [...new Set(body.allergies)];

    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.patient.findFirst({ where: { id, tenantId: me.tenantId } });
      if (!existing) throw new NotFoundException('Patient not found');
      if (existing.mergedIntoId) throw new ConflictException('This record was merged into another: correct that one');
      if (body.nationalId) {
        const same = await tx.patient.findFirst({ where: { tenantId: me.tenantId, nationalId: body.nationalId, NOT: { id } }, select: { mrn: true } });
        if (same) throw new ConflictException(`This national ID is already registered, as ${same.mrn}`);
      }
      const patient = await tx.patient.update({ where: { id }, data });
      // Which fields changed, never their content.
      await this.audit.log(me, 'patient.update', 'Patient', id, { mrn: patient.mrn, fields: changed }, tx);
      return patient;
    });
  }

  /**
   * Merges a duplicate record into this one: its visits, appointments, bills, coverages and problem
   * list move here, details this record lacks are copied, allergies are combined. The duplicate is
   * kept, hidden, so its MRN (on the patient's old card) still finds this record. Admins only, and
   * it can't be undone, so the screen asks first.
   */
  @Post(':id/merge')
  @Roles('ADMIN')
  async merge(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(MergeSchema)) { duplicateId }: z.infer<typeof MergeSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Patient not found');
    if (id === duplicateId) throw new ConflictException('Choose a different record to merge');
    return this.prisma.client.$transaction(async (tx) => {
      const [keep, dup] = await Promise.all([
        tx.patient.findFirst({ where: { id, tenantId: me.tenantId } }),
        tx.patient.findFirst({ where: { id: duplicateId, tenantId: me.tenantId } }),
      ]);
      if (!keep || !dup) throw new NotFoundException('Patient not found');
      if (keep.mrn === WALK_IN_MRN || dup.mrn === WALK_IN_MRN) throw new ConflictException('The pharmacy walk-in record cannot be merged');
      if (keep.mergedIntoId || dup.mergedIntoId) throw new ConflictException('One of these records has already been merged');
      if (keep.nationalId && dup.nationalId && keep.nationalId !== dup.nationalId) {
        throw new ConflictException('These records have different national IDs: they are different people');
      }
      // One open visit per patient.
      const open = await tx.visit.count({ where: { patientId: { in: [id, duplicateId] }, kind: 'OPD', status: { in: ['WAITING', 'IN_CONSULTATION', 'AWAITING_LAB', 'AWAITING_PHARMACY'] } } });
      if (open > 1) throw new ConflictException('Both records have an open visit: finish or cancel one first');

      const to = { patientId: id };
      const from = { patientId: duplicateId };
      const moved = {
        visits: (await tx.visit.updateMany({ where: from, data: to })).count,
        appointments: (await tx.appointment.updateMany({ where: from, data: to })).count,
        invoices: (await tx.invoice.updateMany({ where: from, data: to })).count,
        coverages: (await tx.patientCoverage.updateMany({ where: from, data: to })).count,
        problems: (await tx.patientProblem.updateMany({ where: from, data: to })).count,
      };

      // The household: the duplicate's family joins this record's.
      const family = keep.familyId ?? dup.familyId;
      if (dup.familyId && family && dup.familyId !== family) {
        await tx.patient.updateMany({ where: { tenantId: me.tenantId, familyId: dup.familyId }, data: { familyId: family } });
      }

      const fill: Prisma.PatientUpdateInput = {};
      for (const k of FILL) if (!keep[k] && dup[k]) (fill as Record<string, unknown>)[k] = dup[k];
      // A real birth date beats an estimated one, and either beats none.
      if (dup.dateOfBirth && (!keep.dateOfBirth || (keep.dobEstimated && !dup.dobEstimated))) Object.assign(fill, { dateOfBirth: dup.dateOfBirth, dobEstimated: dup.dobEstimated });
      // The duplicate gives up its national ID first (one record per number).
      await tx.patient.update({ where: { id: duplicateId }, data: { mergedIntoId: id, mergedAt: new Date(), nationalId: null, familyId: null } });
      const kept = await tx.patient.update({
        where: { id },
        data: {
          ...fill,
          ...(!keep.nationalId && dup.nationalId && { nationalId: dup.nationalId }),
          ...(family && { familyId: family }),
          allergies: [...new Set([...keep.allergies, ...dup.allergies])],
        },
      });
      await this.audit.log(me, 'patient.merge', 'Patient', id, { mrn: keep.mrn, duplicate: dup.mrn, moved, filled: Object.keys(fill) }, tx);
      return { ...kept, moved };
    });
  }

}

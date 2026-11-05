import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Prisma, Role, VisitStatus } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { isSettled, prepaymentRequired, settlementSelect } from '../common/settlement.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CheckInSchema = z.object({
  patientId: z.uuid(),
  doctorId: z.uuid().optional(),
  serviceId: z.uuid().optional(), // consultation fee to charge on arrival
  appointmentId: z.uuid().optional(),
});

const QueueQuerySchema = z.object({
  day: z.string().regex(DAY_PATTERN).optional(),
  doctorId: z.uuid().optional(),
});

const STATUSES = ['WAITING', 'IN_CONSULTATION', 'AWAITING_LAB', 'AWAITING_PHARMACY', 'COMPLETED', 'CANCELLED'] as const;
const StatusSchema = z.object({ status: z.enum(STATUSES) });

const ACTIVE: VisitStatus[] = ['WAITING', 'IN_CONSULTATION', 'AWAITING_LAB', 'AWAITING_PHARMACY'];

/** Allowed moves between visit states. */
const TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  WAITING: ['IN_CONSULTATION', 'CANCELLED'],
  IN_CONSULTATION: ['WAITING', 'AWAITING_LAB', 'AWAITING_PHARMACY', 'COMPLETED'],
  AWAITING_LAB: ['IN_CONSULTATION', 'COMPLETED'],
  AWAITING_PHARMACY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

const CLINICAL: Role[] = ['ADMIN', 'DOCTOR', 'NURSE'];
const FRONT_DESK: Role[] = ['ADMIN', 'RECEPTIONIST', 'NURSE'];

export const queuePatientSelect = {
  id: true,
  mrn: true,
  firstName: true,
  fatherName: true,
  grandfather: true,
  firstNameAm: true,
  fatherNameAm: true,
  sex: true,
  dateOfBirth: true,
  phone: true,
  allergies: true,
} satisfies Prisma.PatientSelect;

@Controller()
export class VisitsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The day's queue in arrival order. Defaults to today in the clinic's time zone. */
  @Get('queue')
  async queue(@CurrentUser() me: AuthUser, @Query(new ZodPipe(QueueQuerySchema)) q: z.infer<typeof QueueQuerySchema>) {
    const day = q.day ?? clinicDay();
    const { start, end } = dayRange(day);
    const [visits, prepayment] = await Promise.all([
      this.prisma.client.visit.findMany({
        where: { tenantId: me.tenantId, checkedInAt: { gte: start, lt: end }, ...(q.doctorId ? { doctorId: q.doctorId } : {}) },
        orderBy: { queueNumber: 'asc' },
        include: {
          patient: { select: queuePatientSelect },
          doctor: { select: { id: true, fullName: true } },
          charges: { where: { source: 'CONSULTATION' }, select: settlementSelect },
          labOrders: { where: { status: { not: 'CANCELLED' } }, select: { status: true } },
        },
      }),
      prepaymentRequired(this.prisma.client, me.tenantId),
    ]);
    return {
      day,
      prepayment,
      visits: visits.map(({ charges, labOrders, ...v }) => ({
        ...v,
        consultationPaid: charges.every(isSettled),
        // Every ordered test has a verified result, so the doctor can resume.
        labReady: labOrders.length > 0 && labOrders.every((o) => o.status === 'VERIFIED'),
      })),
    };
  }

  @Post('visits')
  @Roles(...FRONT_DESK)
  async checkIn(@CurrentUser() me: AuthUser, @Body(new ZodPipe(CheckInSchema)) body: z.infer<typeof CheckInSchema>) {
    const db = this.prisma.client;
    const day = clinicDay();
    const { start, end } = dayRange(day);

    return db.$transaction(async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: body.patientId, tenantId: me.tenantId } });
      if (!patient) throw new NotFoundException('Patient not found');

      let doctorId = body.doctorId;
      if (body.appointmentId) {
        const appt = await tx.appointment.findFirst({ where: { id: body.appointmentId, tenantId: me.tenantId } });
        if (!appt || appt.patientId !== patient.id) throw new NotFoundException('Appointment not found for this patient');
        if (appt.status !== 'BOOKED') throw new ConflictException(`This appointment is already ${appt.status.toLowerCase()}`);
        await tx.appointment.update({ where: { id: appt.id }, data: { status: 'ARRIVED' } });
        doctorId ??= appt.doctorId ?? undefined;
      }

      if (doctorId) {
        const doctor = await tx.user.findFirst({ where: { id: doctorId, tenantId: me.tenantId, role: 'DOCTOR', active: true } });
        if (!doctor) throw new NotFoundException('Doctor not found');
      }

      const service = body.serviceId
        ? await tx.serviceItem.findFirst({ where: { id: body.serviceId, tenantId: me.tenantId, active: true } })
        : null;
      if (body.serviceId && !service) throw new NotFoundException('Service not found');

      const open = await tx.visit.findFirst({
        where: { tenantId: me.tenantId, patientId: patient.id, status: { in: ACTIVE }, checkedInAt: { gte: start, lt: end } },
      });
      if (open) throw new ConflictException(`This patient is already in today's queue as number ${open.queueNumber}`);

      // Atomic per-day counter: concurrent check-ins can never share a number.
      const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
        INSERT INTO "QueueCounter" ("tenantId", "day", "last") VALUES (${me.tenantId}, ${day}::date, 1)
        ON CONFLICT ("tenantId", "day") DO UPDATE SET "last" = "QueueCounter"."last" + 1
        RETURNING "last"`;

      const visit = await tx.visit.create({
        data: {
          tenantId: me.tenantId,
          patientId: patient.id,
          doctorId,
          appointmentId: body.appointmentId,
          queueNumber: last,
          ...(service && {
            charges: {
              create: {
                source: 'CONSULTATION',
                sourceId: service.id,
                description: service.name,
                unitPrice: service.price,
              },
            },
          }),
        },
        include: { patient: { select: queuePatientSelect }, doctor: { select: { id: true, fullName: true } }, charges: true },
      });

      await this.audit.log(me, 'visit.checkin', 'Visit', visit.id, { queueNumber: last, patientId: patient.id }, tx);
      return visit;
    });
  }

  @Patch('visits/:id/status')
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  async setStatus(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(StatusSchema)) { status }: z.infer<typeof StatusSchema>,
  ) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');

    return this.prisma.client.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id, tenantId: me.tenantId } });
      if (!visit) throw new NotFoundException('Visit not found');
      if (!TRANSITIONS[visit.status].includes(status)) {
        throw new ConflictException(`Cannot move a visit from ${visit.status} to ${status}`);
      }
      // Front desk can only cancel; clinical moves belong to doctors and nurses.
      if (status !== 'CANCELLED' && !CLINICAL.includes(me.role)) {
        throw new ForbiddenException('Only doctors and nurses can move patients through consultation');
      }

      // Pay first: the doctor can't start until the consultation fee is settled.
      if (status === 'IN_CONSULTATION' && visit.status === 'WAITING' && (await prepaymentRequired(tx, me.tenantId))) {
        const fees = await tx.charge.findMany({ where: { visitId: id, source: 'CONSULTATION' }, select: settlementSelect });
        if (!fees.every(isSettled)) throw new ConflictException('The consultation fee has not been paid yet; send the patient to the cashier');
      }

      if (status === 'AWAITING_LAB') {
        const open = await tx.labOrder.count({ where: { visitId: id, status: { in: ['ORDERED', 'SAMPLE_COLLECTED', 'RESULTED'] } } });
        if (!open) throw new ConflictException('Order a lab test before sending the patient to the lab');
      }

      if (status === 'AWAITING_PHARMACY') {
        const open = await tx.prescription.count({ where: { visitId: id, status: { in: ['PENDING', 'PARTIALLY_DISPENSED'] } } });
        if (!open) throw new ConflictException('Write a prescription before sending the patient to the pharmacy');
      }

      const data: Prisma.VisitUpdateInput = { status };
      if (status === 'IN_CONSULTATION') {
        if (!visit.calledAt) data.calledAt = new Date();
        if (me.role === 'DOCTOR') data.doctor = { connect: { id: me.sub } };
      }
      if (status === 'COMPLETED') data.completedAt = new Date();

      if (status === 'CANCELLED') {
        // Nothing was delivered, so drop charges that haven't been invoiced yet.
        await tx.charge.deleteMany({ where: { visitId: id, invoiceId: null } });
        // Free the appointment so the patient can still be checked in for it later.
        if (visit.appointmentId) {
          await tx.appointment.update({ where: { id: visit.appointmentId }, data: { status: 'BOOKED' } });
          data.appointment = { disconnect: true };
        }
      }

      const updated = await tx.visit.update({
        where: { id },
        data,
        include: { patient: { select: queuePatientSelect }, doctor: { select: { id: true, fullName: true } } },
      });
      await this.audit.log(me, 'visit.status', 'Visit', id, { from: visit.status, to: status }, tx);
      return updated;
    });
  }
}

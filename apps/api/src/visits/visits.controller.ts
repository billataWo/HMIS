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
import type { LabOrderStatus, PrescriptionStatus, Prisma, Role, VisitStatus } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles, AllStaff } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
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
const STATUS_LABEL: Record<VisitStatus, string> = {
  WAITING: 'waiting',
  IN_CONSULTATION: 'with the doctor',
  AWAITING_LAB: 'at the lab',
  AWAITING_PHARMACY: 'at the pharmacy',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** Allowed moves between visit states. */
const TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  WAITING: ['IN_CONSULTATION', 'CANCELLED'],
  IN_CONSULTATION: ['WAITING', 'AWAITING_LAB', 'AWAITING_PHARMACY', 'COMPLETED'],
  AWAITING_LAB: ['IN_CONSULTATION', 'COMPLETED'],
  // Back to the doctor when results arrive or a drug has to be changed.
  AWAITING_PHARMACY: ['IN_CONSULTATION', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Lab work not yet verified: its result hasn't reached the doctor. */
export const OPEN_LAB: LabOrderStatus[] = ['ORDERED', 'SAMPLE_COLLECTED', 'RESULTED'];
/** Prescriptions with drugs still to hand over. */
export const OPEN_RX: PrescriptionStatus[] = ['PENDING', 'PARTIALLY_DISPENSED'];

/** Names of this visit's tests whose results the doctor hasn't been able to see yet. */
export async function pendingLabTests(tx: Pick<Prisma.TransactionClient, 'labOrder'>, visitId: string) {
  const open = await tx.labOrder.findMany({ where: { visitId, status: { in: OPEN_LAB } }, select: { labTest: { select: { name: true } } } });
  return open.map((o) => o.labTest.name);
}

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
  @AllStaff()
  @Get('queue')
  async queue(@CurrentUser() me: AuthUser, @Query(new ZodPipe(QueueQuerySchema)) q: z.infer<typeof QueueQuerySchema>) {
    const day = q.day ?? clinicDay();
    const { start, end } = dayRange(day);
    // Today's queue also carries unfinished visits from earlier days (a fasting sample taken the
    // next morning, a culture that takes two days), so they stay visible until someone closes them.
    const carryOver = day === clinicDay();
    const [visits, prepayment] = await Promise.all([
      this.prisma.client.visit.findMany({
        where: {
          tenantId: me.tenantId,
          kind: 'OPD', // pharmacy counter sales are not part of the queue
          ...(q.doctorId ? { doctorId: q.doctorId } : {}),
          OR: [
            { checkedInAt: { gte: start, lt: end } },
            ...(carryOver ? [{ status: { in: ACTIVE }, checkedInAt: { lt: start } }] : []),
          ],
        },
        orderBy: [{ checkedInAt: 'asc' }, { queueNumber: 'asc' }],
        include: {
          patient: { select: queuePatientSelect },
          doctor: { select: { id: true, fullName: true } },
          charges: { where: { voidedAt: null }, select: { source: true, quantity: true, unitPrice: true, ...settlementSelect } },
          _count: { select: { diagnoses: true } },
          labOrders: { where: { status: { not: 'CANCELLED' } }, select: { status: true } },
          prescriptions: { where: { status: { in: OPEN_RX } }, select: { id: true } },
        },
      }),
      prepaymentRequired(this.prisma.client, me.tenantId),
    ]);
    return {
      day,
      prepayment,
      visits: visits.map(({ charges, labOrders, prescriptions, _count, ...v }) => ({
        ...v,
        carriedOver: v.checkedInAt < start,
        consultationPaid: charges.filter((c) => c.source === 'CONSULTATION').every(isSettled),
        diagnosed: _count.diagnoses > 0,
        // Anything else the patient still has to pay (procedures, tests, drugs), so nobody leaves owing.
        owed: fromCents(charges.filter((c) => c.source !== 'CONSULTATION' && !isSettled(c)).reduce((s, c) => s + toCents(c.unitPrice) * c.quantity, 0)),
        // Every ordered test has a verified result, so the doctor can resume.
        labReady: labOrders.length > 0 && labOrders.every((o) => o.status === 'VERIFIED'),
        // What the visit is still waiting for, so the queue only offers moves that can succeed.
        labPending: labOrders.some((o) => OPEN_LAB.includes(o.status)),
        rxPending: prescriptions.length > 0,
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

      // One open visit per patient: an unfinished one from an earlier day must be closed first.
      const open = await tx.visit.findFirst({
        where: { tenantId: me.tenantId, kind: 'OPD', patientId: patient.id, status: { in: ACTIVE } },
        orderBy: { checkedInAt: 'desc' },
      });
      if (open && open.checkedInAt >= start && open.checkedInAt < end) {
        throw new ConflictException(`This patient is already in today's queue as number ${open.queueNumber}`);
      }
      if (open) {
        throw new ConflictException(
          `This patient still has an open visit from ${clinicDay(open.checkedInAt)} (queue number ${open.queueNumber}, ${STATUS_LABEL[open.status]}). ` +
            'It is shown at the top of the queue: finish it there, or cancel it if they were never seen.',
        );
      }

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
        const fees = await tx.charge.findMany({ where: { visitId: id, source: 'CONSULTATION', voidedAt: null }, select: settlementSelect });
        if (!fees.every(isSettled)) throw new ConflictException('The consultation fee has not been paid yet; send the patient to the cashier');
      }

      if (status === 'AWAITING_LAB') {
        const open = await tx.labOrder.count({ where: { visitId: id, status: { in: OPEN_LAB } } });
        if (!open) throw new ConflictException('Order a lab test before sending the patient to the lab');
      }

      if (status === 'AWAITING_PHARMACY') {
        const open = await tx.prescription.count({ where: { visitId: id, status: { in: OPEN_RX } } });
        if (!open) throw new ConflictException('Write a prescription before sending the patient to the pharmacy');
      }

      // Ending the consultation (done, or off to the pharmacy, which then closes the visit) needs a
      // diagnosis: the visit record and the monthly MoH report are built from it.
      if ((status === 'COMPLETED' || status === 'AWAITING_PHARMACY') && visit.kind === 'OPD' && visit.status !== 'AWAITING_PHARMACY') {
        const diagnoses = await tx.diagnosis.count({ where: { visitId: id } });
        if (!diagnoses) throw new ConflictException('Record a diagnosis first: it is part of the visit record and the monthly MoH report');
      }

      if (status === 'COMPLETED') {
        // A result nobody has seen is a safety risk: finish or cancel the tests first.
        const pending = await pendingLabTests(tx, id);
        if (pending.length) {
          throw new ConflictException(
            `Lab results are still pending (${pending.join(', ')}). Wait for the lab to verify them, or cancel tests whose sample hasn't been taken.`,
          );
        }
        // Drugs still to collect: the patient goes to the pharmacy, which closes the visit once
        // everything is dispensed. (From the pharmacy itself, staff may close it: patient left.)
        if (visit.status !== 'AWAITING_PHARMACY') {
          const openRx = await tx.prescription.count({ where: { visitId: id, status: { in: OPEN_RX } } });
          if (openRx) {
            throw new ConflictException('This patient still has drugs to collect: send them to the pharmacy instead. The visit closes by itself once everything is dispensed.');
          }
        }
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

import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles, AllStaff } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';

const BookSchema = z.object({
  patientId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }),
  doctorId: z.uuid().optional(),
  reason: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s || undefined)
    .optional(),
});

const ListSchema = z.object({
  day: z.string().regex(DAY_PATTERN).optional(),
  patientId: z.uuid().optional(),
});

const UpdateSchema = z.object({ status: z.enum(['CANCELLED', 'NO_SHOW']) });

const include = {
  patient: { select: queuePatientSelect },
  doctor: { select: { id: true, fullName: true } },
  visit: { select: { id: true, queueNumber: true, status: true } },
} as const;

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A day's appointments (default today), or a patient's upcoming ones when patientId is given. */
  @AllStaff()
  @Get()
  list(@CurrentUser() me: AuthUser, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    if (q.patientId && !q.day) {
      return this.prisma.client.appointment.findMany({
        where: { tenantId: me.tenantId, patientId: q.patientId, status: 'BOOKED', scheduledAt: { gte: dayRange(clinicDay()).start } },
        orderBy: { scheduledAt: 'asc' },
        include,
      });
    }
    const { start, end } = dayRange(q.day ?? clinicDay());
    return this.prisma.client.appointment.findMany({
      where: { tenantId: me.tenantId, scheduledAt: { gte: start, lt: end }, ...(q.patientId ? { patientId: q.patientId } : {}) },
      orderBy: { scheduledAt: 'asc' },
      include,
    });
  }

  @Post()
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  async book(@CurrentUser() me: AuthUser, @Body(new ZodPipe(BookSchema)) body: z.infer<typeof BookSchema>) {
    const db = this.prisma.client;
    const scheduledAt = new Date(body.scheduledAt);
    if (scheduledAt.getTime() < Date.now() - 15 * 60 * 1000) {
      throw new ConflictException('Appointment time is in the past');
    }

    const patient = await db.patient.findFirst({ where: { id: body.patientId, tenantId: me.tenantId } });
    if (!patient) throw new NotFoundException('Patient not found');
    if (body.doctorId) {
      const doctor = await db.user.findFirst({ where: { id: body.doctorId, tenantId: me.tenantId, role: 'DOCTOR', active: true } });
      if (!doctor) throw new NotFoundException('Doctor not found');
    }

    const appt = await db.appointment.create({
      data: { tenantId: me.tenantId, patientId: patient.id, doctorId: body.doctorId, scheduledAt, reason: body.reason },
      include,
    });
    await this.audit.log(me, 'appointment.book', 'Appointment', appt.id, { scheduledAt: body.scheduledAt });
    return appt;
  }

  @Patch(':id')
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  async update(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateSchema)) { status }: z.infer<typeof UpdateSchema>,
  ) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Appointment not found');
    const appt = await this.prisma.client.appointment.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.status !== 'BOOKED') throw new ConflictException(`This appointment is already ${appt.status.toLowerCase()}`);

    const updated = await this.prisma.client.appointment.update({ where: { id }, data: { status }, include });
    await this.audit.log(me, 'appointment.status', 'Appointment', id, { to: status });
    return updated;
  }
}

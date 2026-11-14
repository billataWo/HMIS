import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles, AllStaff } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertNotMerged } from '../patients/merged.js';
import { usableCoverages } from '../billing/coverage.js';
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

const note = z
  .string()
  .trim()
  .max(500)
  .transform((s) => s || null)
  .optional();
/** The reminder call before the day. */
const ReminderSchema = z.object({ outcome: z.enum(['CONFIRMED', 'NO_ANSWER', 'CANNOT_COME', 'WRONG_NUMBER']) });
/** The call after a missed appointment. */
const TraceSchema = z.object({ outcome: z.enum(['REBOOKED', 'WILL_COME', 'NO_ANSWER', 'WRONG_NUMBER', 'DECLINED']), note });
const MoveSchema = z.object({ scheduledAt: z.iso.datetime({ offset: true }), doctorId: z.uuid().nullable().optional() });
const DaySchema = z.object({ day: z.string().regex(DAY_PATTERN).optional() });

const FRONT_DESK = ['ADMIN', 'RECEPTIONIST', 'NURSE'] as const;
/** How far back missed appointments are followed up. */
export const MISSED_DAYS = 90;

/**
 * Appointments still "booked" for a day that has ended were missed. Marked as the lists are read,
 * so clinic servers without the cloud's scheduler keep it right too.
 */
export async function markNoShows(db: { appointment: Prisma.TransactionClient['appointment'] }, tenantId: string) {
  return db.appointment.updateMany({ where: { tenantId, status: 'BOOKED', scheduledAt: { lt: dayRange(clinicDay()).start } }, data: { status: 'NO_SHOW' } });
}

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

const include = {
  // With the coverages the patient can use today, for check-in on their payer.
  patient: { select: { ...queuePatientSelect, coverages: usableCoverages() } },
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
  async list(@CurrentUser() me: AuthUser, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    await markNoShows(this.prisma.client, me.tenantId);
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

  /** The reminder calls for a day (default tomorrow): who is booked, their phone, and what came of each call. */
  @Get('reminders')
  @Roles(...FRONT_DESK, 'DOCTOR')
  async reminders(@CurrentUser() me: AuthUser, @Query(new ZodPipe(DaySchema)) q: z.infer<typeof DaySchema>) {
    const day = q.day ?? shiftDay(clinicDay(), 1);
    const { start, end } = dayRange(day);
    const appts = await this.prisma.client.appointment.findMany({
      where: { tenantId: me.tenantId, status: 'BOOKED', scheduledAt: { gte: start, lt: end } },
      orderBy: { scheduledAt: 'asc' },
      include: { patient: { select: queuePatientSelect }, doctor: { select: { id: true, fullName: true } } },
    });
    const callers = await this.names(appts.map((a) => a.reminderById));
    return { day, appointments: appts.map((a) => ({ ...a, reminderBy: callers.get(a.reminderById ?? '') ?? null })) };
  }

  @Post(':id/reminder')
  @Roles(...FRONT_DESK, 'DOCTOR')
  async remind(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ReminderSchema)) { outcome }: z.infer<typeof ReminderSchema>) {
    const appt = await this.find(me, id);
    if (appt.status !== 'BOOKED') throw new ConflictException(`This appointment is already ${appt.status.toLowerCase().replace('_', '-')}`);
    const updated = await this.prisma.client.appointment.update({ where: { id }, data: { reminderSentAt: new Date(), reminderOutcome: outcome, reminderById: me.sub } });
    await this.audit.log(me, 'appointment.reminder', 'Appointment', id, { outcome });
    return updated;
  }

  /**
   * Missed appointments to follow up (last 90 days): the patient has not been seen since and has
   * nothing booked, and has not said they won't come. Patients with a long-term condition first
   * (a missed hypertension, diabetes or HIV review matters most), then the oldest.
   */
  @Get('missed')
  @Roles(...FRONT_DESK, 'DOCTOR')
  async missed(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    await markNoShows(db, me.tenantId);
    const since = dayRange(shiftDay(clinicDay(), -MISSED_DAYS)).start;
    const missed = await db.appointment.findMany({
      where: { tenantId: me.tenantId, status: 'NO_SHOW', scheduledAt: { gte: since }, OR: [{ traceOutcome: null }, { traceOutcome: { notIn: ['DECLINED', 'REBOOKED'] } }] },
      orderBy: { scheduledAt: 'desc' },
      include: {
        patient: {
          select: {
            ...queuePatientSelect,
            mergedIntoId: true,
            problems: { where: { status: 'ACTIVE' }, select: { label: true } },
            visits: { where: { kind: 'OPD', status: { not: 'CANCELLED' } }, orderBy: { checkedInAt: 'desc' }, take: 1, select: { checkedInAt: true } },
            appointments: { where: { status: 'BOOKED' }, select: { id: true } },
          },
        },
        doctor: { select: { id: true, fullName: true } },
      },
    });
    const seen = new Set<string>();
    const rows = missed.filter((a) => {
      // The latest miss per patient; none once they came back, booked again or were merged away.
      if (seen.has(a.patientId)) return false;
      seen.add(a.patientId);
      const p = a.patient;
      if (p.mergedIntoId || p.appointments.length) return false;
      return !(p.visits[0] && p.visits[0].checkedInAt > a.scheduledAt);
    });
    const tracers = await this.names(rows.map((a) => a.tracedById));
    return rows
      .map(({ patient: { problems, visits, appointments, mergedIntoId, ...patient }, ...a }) => ({
        ...a,
        patient,
        problems: problems.map((x) => x.label),
        lastVisitAt: visits[0]?.checkedInAt ?? null,
        tracedBy: tracers.get(a.tracedById ?? '') ?? null,
      }))
      .sort((x, y) => Number(y.problems.length > 0) - Number(x.problems.length > 0) || x.scheduledAt.getTime() - y.scheduledAt.getTime());
  }

  @Post(':id/trace')
  @Roles(...FRONT_DESK, 'DOCTOR')
  async trace(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(TraceSchema)) body: z.infer<typeof TraceSchema>) {
    const appt = await this.find(me, id);
    if (appt.status !== 'NO_SHOW') throw new ConflictException('Only a missed appointment is followed up');
    const updated = await this.prisma.client.appointment.update({
      where: { id },
      data: { traceOutcome: body.outcome, traceNote: body.note ?? null, tracedAt: new Date(), tracedById: me.sub },
    });
    await this.audit.log(me, 'appointment.trace', 'Appointment', id, { outcome: body.outcome });
    return updated;
  }

  /**
   * Bookings per day and doctor from today (BOOKED), to spread them out: shown while booking.
   * `doctorId` null counts "any doctor".
   */
  @Get('load')
  @AllStaff()
  async load(@CurrentUser() me: AuthUser) {
    const from = clinicDay();
    const appts = await this.prisma.client.appointment.findMany({
      where: { tenantId: me.tenantId, status: 'BOOKED', scheduledAt: { gte: dayRange(from).start, lt: dayRange(shiftDay(from, 60)).start } },
      select: { scheduledAt: true, doctorId: true },
    });
    const counts = new Map<string, { day: string; doctorId: string | null; count: number }>();
    for (const a of appts) {
      const day = clinicDay(a.scheduledAt);
      const k = `${day}|${a.doctorId ?? ''}`;
      const row = counts.get(k) ?? { day, doctorId: a.doctorId, count: 0 };
      row.count++;
      counts.set(k, row);
    }
    return [...counts.values()];
  }

  /** Moves a booked appointment to another time (or doctor): the reminder is due again. */
  @Patch(':id/move')
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  async move(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(MoveSchema)) body: z.infer<typeof MoveSchema>) {
    const appt = await this.find(me, id);
    if (appt.status !== 'BOOKED') throw new ConflictException(`This appointment is already ${appt.status.toLowerCase().replace('_', '-')}`);
    const scheduledAt = new Date(body.scheduledAt);
    if (scheduledAt.getTime() < Date.now() - 15 * 60 * 1000) throw new ConflictException('Appointment time is in the past');
    if (body.doctorId) {
      const doctor = await this.prisma.client.user.findFirst({ where: { id: body.doctorId, tenantId: me.tenantId, role: 'DOCTOR', active: true } });
      if (!doctor) throw new NotFoundException('Doctor not found');
    }
    const updated = await this.prisma.client.appointment.update({
      where: { id },
      data: { scheduledAt, ...(body.doctorId !== undefined && { doctorId: body.doctorId }), reminderSentAt: null, reminderOutcome: null, reminderById: null },
      include,
    });
    await this.audit.log(me, 'appointment.move', 'Appointment', id, { from: appt.scheduledAt.toISOString(), to: body.scheduledAt });
    return updated;
  }

  private async find(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Appointment not found');
    const appt = await this.prisma.client.appointment.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  /** Staff names by id. */
  private async names(ids: (string | null)[]) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const users = want.length ? await this.prisma.client.user.findMany({ where: { id: { in: want } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
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
    await assertNotMerged(db, patient);
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

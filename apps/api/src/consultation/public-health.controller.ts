import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ageAt } from '../reports/reports.controller.js';
import { queuePatientSelect } from '../visits/visits.controller.js';
import { epiWeek, malariaSpecies, NOTIFIABLE, notifiableIn } from './notifiable.js';

const NotifySchema = z.object({
  disease: z.string().trim().max(40),
  reportedTo: z.string().trim().min(2, 'Say who it was reported to').max(200),
  note: z
    .string()
    .trim()
    .max(1000)
    .transform((s) => s || null)
    .nullable()
    .optional(),
});
const WeekSchema = z.object({ day: z.string().regex(DAY_PATTERN).optional() });

/** How far back the report looks for immediately reportable cases nobody has reported yet. */
const UNREPORTED_DAYS = 30;

function shift(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const caseSelect = {
  id: true,
  checkedInAt: true,
  patientId: true,
  patient: { select: { ...queuePatientSelect, address: true } },
  diagnoses: { select: { icd11Code: true, label: true } },
  notifications: true,
} as const;

/**
 * Public health reporting (IDSR): an immediately reportable disease is flagged on the visit and
 * the report to the woreda health office is recorded; the weekly report counts every priority
 * disease (zero included) and the malaria tests.
 */
@Controller()
export class PublicHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Records that an immediately reportable case was reported (phoned through) to public health. */
  @Post('visits/:id/notifications')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async notify(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(NotifySchema)) body: z.infer<typeof NotifySchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const visit = await this.prisma.client.visit.findFirst({
      where: { id, tenantId: me.tenantId },
      select: { kind: true, status: true, diagnoses: { select: { icd11Code: true, label: true } }, notifications: { select: { disease: true } } },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    if (visit.kind !== 'OPD' || visit.status === 'CANCELLED') throw new ConflictException('Only a consultation can be reported');
    const disease = notifiableIn(visit.diagnoses).find((d) => d.key === body.disease);
    if (!disease) throw new ConflictException('This visit has no diagnosis of that disease');
    if (!disease.immediate) throw new ConflictException(`${disease.label} is counted on the weekly report, not reported case by case`);
    if (visit.notifications.some((n) => n.disease === disease.key)) throw new ConflictException(`${disease.label} has already been reported for this visit`);
    const n = await this.prisma.client.diseaseNotification.create({
      data: { tenantId: me.tenantId, visitId: id, disease: disease.key, reportedTo: body.reportedTo, note: body.note, reportedById: me.sub },
    });
    await this.audit.log(me, 'idsr.notify', 'Visit', id, { disease: disease.key });
    return { ...n, reportedBy: { id: me.sub, fullName: me.name ?? null } };
  }

  /**
   * The weekly IDSR report for the epidemiological week (Monday to Sunday) containing `day`,
   * by default last week. A patient counts once per disease per week, from all of a visit's
   * diagnoses. Deaths are not recorded here and are added by hand.
   */
  @Get('reports/idsr-weekly')
  @Roles('ADMIN')
  async weekly(@CurrentUser() me: AuthUser, @Query(new ZodPipe(WeekSchema)) q: z.infer<typeof WeekSchema>) {
    const today = clinicDay();
    const week = epiWeek(q.day ?? shift(today, -7));
    const range = { gte: dayRange(week.start).start, lt: dayRange(week.end).start };
    const db = this.prisma.client;
    const t = me.tenantId;
    const since = dayRange(shift(today, -UNREPORTED_DAYS)).start;

    const [tenant, visits, recent, malaria] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: t }, select: { name: true, nameAm: true, address: true, phone: true } }),
      db.visit.findMany({ where: { tenantId: t, kind: 'OPD', status: { not: 'CANCELLED' }, checkedInAt: range, diagnoses: { some: {} } }, select: caseSelect }),
      db.visit.findMany({ where: { tenantId: t, kind: 'OPD', status: { not: 'CANCELLED' }, checkedInAt: { gte: since }, diagnoses: { some: {} } }, select: caseSelect }),
      db.labOrder.findMany({
        where: { tenantId: t, status: 'VERIFIED', verifiedAt: range, labTest: { name: { contains: 'malaria', mode: 'insensitive' } } },
        select: { resultValue: true },
      }),
    ]);

    const counts = new Map(NOTIFIABLE.map((d) => [d.key, { under5: 0, over5: 0, unknownAge: 0 }]));
    const seen = new Set<string>();
    for (const v of visits) {
      for (const d of notifiableIn(v.diagnoses)) {
        const key = `${v.patientId}:${d.key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const age = ageAt(v.patient.dateOfBirth, v.checkedInAt);
        const c = counts.get(d.key)!;
        if (age === null) c.unknownAge++;
        else if (age < 5) c.under5++;
        else c.over5++;
      }
    }

    /** Each immediately reportable disease of each visit, with its report if made. */
    const cases = (vs: typeof visits) =>
      vs
        .flatMap((v) =>
          notifiableIn(v.diagnoses)
            .filter((d) => d.immediate)
            .map((d) => {
              const n = v.notifications.find((x) => x.disease === d.key);
              return {
                visitId: v.id,
                checkedInAt: v.checkedInAt,
                patient: v.patient,
                disease: d.key,
                label: d.label,
                notification: n ? { reportedAt: n.reportedAt, reportedTo: n.reportedTo, note: n.note, reportedById: n.reportedById } : null,
              };
            }),
        )
        .sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime());
    const immediate = cases(visits);
    const unreported = cases(recent).filter((c) => !c.notification);
    const reporters = await db.user.findMany({
      where: { id: { in: [...new Set(immediate.flatMap((c) => (c.notification ? [c.notification.reportedById] : [])))] } },
      select: { id: true, fullName: true },
    });

    const tested = malaria.filter((m) => m.resultValue);
    const positive = tested.filter((m) => !/^neg/i.test(m.resultValue!));
    const species = (s: string) => positive.filter((m) => malariaSpecies(m.resultValue!) === s).length;

    return {
      facility: tenant,
      week: { ...week, inProgress: today < week.end },
      diseases: NOTIFIABLE.map((d) => {
        const c = counts.get(d.key)!;
        return { key: d.key, label: d.label, labelAm: d.labelAm, immediate: d.immediate, ...c, total: c.under5 + c.over5 + c.unknownAge };
      }),
      malaria: { tested: tested.length, positive: positive.length, falciparum: species('PF'), vivax: species('PV'), mixed: species('MIXED'), notStated: species('OTHER') },
      immediateCases: immediate.map((c) => ({
        ...c,
        notification: c.notification && { ...c.notification, reportedBy: reporters.find((u) => u.id === c.notification!.reportedById)?.fullName ?? null },
      })),
      unreported: unreported.map((c) => ({ visitId: c.visitId, checkedInAt: c.checkedInAt, patient: c.patient, disease: c.disease, label: c.label })),
      unreportedDays: UNREPORTED_DAYS,
    };
  }
}

/** A visit's notifiable diseases, each with its report (immediate ones) for the consultation screen. */
export async function visitNotifiable(
  prisma: PrismaService,
  diagnoses: { icd11Code: string; label: string }[],
  notifications: { disease: string; reportedTo: string; note: string | null; reportedAt: Date; reportedById: string }[],
) {
  const found = notifiableIn(diagnoses);
  if (!found.length) return [];
  const users = notifications.length
    ? await prisma.client.user.findMany({ where: { id: { in: notifications.map((n) => n.reportedById) } }, select: { id: true, fullName: true } })
    : [];
  return found.map((d) => {
    const n = notifications.find((x) => x.disease === d.key);
    return {
      key: d.key,
      label: d.label,
      labelAm: d.labelAm,
      immediate: d.immediate,
      notification: n ? { reportedAt: n.reportedAt, reportedTo: n.reportedTo, note: n.note, reportedBy: users.find((u) => u.id === n.reportedById)?.fullName ?? null } : null,
    };
  });
}

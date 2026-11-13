import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Role } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequiresFeature } from '../platform/subscription.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { repriceVisit, visitCoverage } from './coverage.js';

/** The front desk records coverage at registration and check-in; the cashier may fix it at the counter. */
const DESK: Role[] = ['ADMIN', 'RECEPTIONIST', 'NURSE', 'CASHIER'];
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();
/** Covered through the whole of that day. */
const until = z
  .string()
  .regex(DAY_PATTERN, 'Use a date like 2027-06-30')
  .transform((d) => new Date(dayRange(d).end.getTime() - 1))
  .nullable()
  .optional();

const CoverageSchema = z.object({ payerId: z.uuid(), memberId: text(60), holder: text(200), validUntil: until });
const CoverageUpdateSchema = z.object({ memberId: text(60), holder: text(200), validUntil: until, active: z.boolean().optional() });
const VisitCoverageSchema = z.object({
  /** null: the patient pays for this visit themselves. */
  coverageId: z.uuid().nullable(),
  authorizationNo: z
    .string()
    .trim()
    .max(100)
    .transform((s) => s || undefined)
    .optional(),
});

/** Who pays for a patient: their credit company or insurer, member number and dates. */
@Controller()
export class CoverageController {
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

  @Get('patients/:id/coverages')
  @Roles(...DESK, 'DOCTOR', 'LAB_TECH') // the lab takes lab-only requests
  async list(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.patient(me, id);
    return this.prisma.client.patientCoverage.findMany({
      where: { patientId: id },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      include: { payer: { select: { id: true, name: true, type: true, coPayPercent: true, requiresAuthorization: true, active: true } } },
    });
  }

  @Post('patients/:id/coverages')
  @RequiresFeature('CREDIT')
  @Roles(...DESK)
  async add(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(CoverageSchema)) body: z.infer<typeof CoverageSchema>) {
    await this.patient(me, id);
    const payer = await this.prisma.client.payer.findFirst({ where: { id: body.payerId, tenantId: me.tenantId, active: true } });
    if (!payer) throw new NotFoundException('Payer not found');
    const dup = await this.prisma.client.patientCoverage.findFirst({ where: { patientId: id, payerId: payer.id, active: true } });
    if (dup) throw new ConflictException(`This patient is already covered by ${payer.name}; edit that coverage instead`);
    const c = await this.prisma.client.patientCoverage.create({ data: { ...body, tenantId: me.tenantId, patientId: id } });
    await this.audit.log(me, 'coverage.add', 'Patient', id, { payer: payer.name, memberId: body.memberId });
    return c;
  }

  @Patch('coverages/:id')
  @RequiresFeature('CREDIT')
  @Roles(...DESK)
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(CoverageUpdateSchema)) body: z.infer<typeof CoverageUpdateSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Coverage not found');
    const c = await this.prisma.client.patientCoverage.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!c) throw new NotFoundException('Coverage not found');
    const updated = await this.prisma.client.patientCoverage.update({ where: { id }, data: body });
    await this.audit.log(me, 'coverage.update', 'Patient', c.patientId, { coverage: id, fields: Object.keys(body) });
    return updated;
  }

  /**
   * Changes who pays for a visit after check-in (the patient showed their card late, or it was
   * chosen by mistake). What isn't invoiced yet is priced again for the new payer; what is
   * invoiced stays as billed.
   */
  @Post('visits/:id/coverage')
  @Roles(...DESK)
  async setVisitCoverage(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(VisitCoverageSchema)) body: z.infer<typeof VisitCoverageSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    return this.prisma.client.$transaction(async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id, tenantId: me.tenantId } });
      if (!visit) throw new NotFoundException('Visit not found');
      if (visit.status === 'CANCELLED') throw new ConflictException('This visit was cancelled');
      const terms = body.coverageId ? await visitCoverage(tx, me.tenantId, visit.patientId, body.coverageId, body.authorizationNo) : null;
      await tx.visit.update({
        where: { id },
        data: {
          payerId: terms?.payerId ?? null,
          memberId: terms?.memberId ?? null,
          coPayPercent: terms?.coPayPercent ?? null,
          authorizationNo: terms?.authorizationNo ?? null,
        },
      });
      const repriced = await repriceVisit(tx, id, terms?.payerId ?? null);
      await this.audit.log(me, 'visit.coverage', 'Visit', id, { payer: terms?.payer.name ?? 'self', repriced }, tx);
      return { visitId: id, payerId: terms?.payerId ?? null, repriced };
    });
  }
}

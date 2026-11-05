import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { allergyAlerts, interactionAlerts } from './drug-safety.js';

export const FREQUENCIES = ['OD', 'BID', 'TID', 'QID', 'NOCTE', 'PRN', 'STAT'] as const;

const ItemSchema = z.object({
  drugId: z.uuid(),
  dose: z.string().trim().min(1).max(50),
  frequency: z.enum(FREQUENCIES),
  durationDays: z.number().int().min(1).max(365).optional(),
  quantity: z.number().int().min(1).max(10_000),
  instructions: z
    .string()
    .trim()
    .max(300)
    .transform((s) => s || undefined)
    .optional(),
});

const CreateSchema = z.object({
  items: z.array(ItemSchema).min(1, 'Add at least one drug').max(20),
  acknowledgeAlerts: z.boolean().default(false),
  overrideReason: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s || undefined)
    .optional(),
});

export const prescriptionInclude = {
  prescriber: { select: { id: true, fullName: true } },
  items: {
    include: { drug: { select: { id: true, genericName: true, brandName: true, form: true, strength: true, unit: true, sellPrice: true } } },
  },
} satisfies Prisma.PrescriptionInclude;

@Controller()
export class PrescriptionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async visit(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const visit = await this.prisma.client.visit.findFirst({
      where: { id, tenantId: me.tenantId },
      include: { patient: { select: { allergies: true } } },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  @Get('visits/:id/prescriptions')
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST')
  async list(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.visit(me, id);
    return this.prisma.client.prescription.findMany({
      where: { visitId: id, tenantId: me.tenantId },
      orderBy: { createdAt: 'asc' },
      include: prescriptionInclude,
    });
  }

  /**
   * Creates a prescription. If the drugs trigger allergy, interaction or duplicate alerts, the
   * first attempt is refused with the alerts; the doctor resubmits with acknowledgeAlerts, plus
   * a written reason when overriding an allergy. The accepted alerts are stored with it.
   */
  @Post('visits/:id/prescriptions')
  @Roles('DOCTOR')
  async create(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>) {
    const db = this.prisma.client;
    const visit = await this.visit(me, id);
    if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') {
      throw new ConflictException('This visit is closed; prescriptions can no longer be added');
    }

    const drugIds = [...new Set(body.items.map((i) => i.drugId))];
    const drugs = await db.drug.findMany({ where: { id: { in: drugIds }, tenantId: me.tenantId, active: true } });
    if (drugs.length !== drugIds.length) throw new NotFoundException('One or more drugs were not found');

    // Check the new drugs against each other and against anything else prescribed in this visit.
    const existing = await db.prescriptionItem.findMany({
      where: { prescription: { visitId: id, status: { not: 'CANCELLED' } } },
      include: { drug: true },
    });
    const newDrugs = body.items.map((i) => drugs.find((d) => d.id === i.drugId)!);
    const alerts = [
      ...allergyAlerts(visit.patient.allergies, drugs),
      ...interactionAlerts([...existing.map((e) => e.drug), ...newDrugs], existing.length),
    ];

    if (alerts.length && !body.acknowledgeAlerts) {
      throw new ConflictException({ message: 'Review the prescribing alerts before continuing', alerts });
    }
    if (alerts.some((a) => a.severity === 'BLOCK') && (!body.overrideReason || body.overrideReason.length < 5)) {
      throw new ConflictException({ message: 'Give a reason for prescribing despite the allergy', alerts });
    }

    const prescription = await db.prescription.create({
      data: {
        tenantId: me.tenantId,
        visitId: id,
        prescriberId: me.sub,
        alerts: alerts.length ? (alerts as unknown as Prisma.InputJsonValue) : undefined,
        overrideReason: alerts.length ? body.overrideReason : undefined,
        items: { create: body.items },
      },
      include: prescriptionInclude,
    });
    await this.audit.log(me, 'prescription.create', 'Prescription', prescription.id, {
      visitId: id,
      items: body.items.length,
      alertsAccepted: alerts.map((a) => a.type),
    });
    return prescription;
  }

  @Post('prescriptions/:id/cancel')
  @Roles('DOCTOR')
  async cancel(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Prescription not found');
    return this.prisma.client.$transaction(async (tx) => {
      const p = await tx.prescription.findFirst({ where: { id, tenantId: me.tenantId }, include: { items: { select: { id: true } } } });
      if (!p) throw new NotFoundException('Prescription not found');
      if (p.status !== 'PENDING') throw new ConflictException('Only prescriptions that have not been dispensed can be cancelled');

      // Drop charges that haven't reached an invoice; invoiced ones need the invoice voided first.
      const itemIds = p.items.map((i) => i.id);
      const invoiced = await tx.charge.count({ where: { source: 'PHARMACY', sourceId: { in: itemIds }, invoiceId: { not: null } } });
      if (invoiced) throw new ConflictException('These drugs are already on an invoice; ask an admin to void it before cancelling');
      await tx.charge.deleteMany({ where: { source: 'PHARMACY', sourceId: { in: itemIds }, invoiceId: null } });

      const updated = await tx.prescription.update({ where: { id }, data: { status: 'CANCELLED' }, include: prescriptionInclude });
      await this.audit.log(me, 'prescription.cancel', 'Prescription', id, undefined, tx);
      return updated;
    });
  }
}

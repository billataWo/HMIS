import { Body, ConflictException, Controller, NotFoundException, Post } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { WALK_IN_MRN } from '../patients/patients.controller.js';
import { allergyAlerts } from '../prescriptions/drug-safety.js';
import { prescriptionInclude } from '../prescriptions/prescriptions.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SaleSchema = z.object({
  patientId: z.uuid().optional(), // a registered patient, or none for an unnamed customer
  items: z
    .array(
      z.object({
        drugId: z.uuid(),
        quantity: z.number().int().min(1).max(10_000),
        instructions: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, 'Add at least one drug')
    .max(30),
  acknowledgeAlerts: z.boolean().default(false),
});

/**
 * Over-the-counter sales to customers who did not see a doctor. A sale becomes a "walk-in" visit
 * at the pharmacy with a prescription written by the pharmacist, so the usual steps apply
 * unchanged: send to the cashier, pay, dispense (first-expiry-first-out); the visit closes itself
 * once everything is handed over. Walk-in visits are kept out of the queue and OPD reports.
 */
@Controller('pharmacy/walk-in')
export class WalkInController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  async sell(@CurrentUser() me: AuthUser, @Body(new ZodPipe(SaleSchema)) body: z.infer<typeof SaleSchema>) {
    return this.prisma.client.$transaction(async (tx) => {
      const patient = body.patientId
        ? await tx.patient.findFirst({ where: { id: body.patientId, tenantId: me.tenantId } })
        : await this.walkInPatient(tx, me.tenantId);
      if (!patient) throw new NotFoundException('Patient not found');

      const drugIds = [...new Set(body.items.map((i) => i.drugId))];
      if (drugIds.length !== body.items.length) throw new ConflictException('Each drug may appear only once');
      const drugs = await tx.drug.findMany({ where: { id: { in: drugIds }, tenantId: me.tenantId, active: true } });
      if (drugs.length !== drugIds.length) throw new NotFoundException('One or more drugs were not found');

      // A named customer's recorded allergies are checked, as for a doctor's prescription.
      const alerts = allergyAlerts(patient.allergies, drugs);
      if (alerts.length && !body.acknowledgeAlerts) {
        throw new ConflictException({ message: 'This customer is allergic to a drug in the sale', alerts });
      }

      const visit = await tx.visit.create({
        data: { tenantId: me.tenantId, patientId: patient.id, kind: 'WALK_IN', status: 'AWAITING_PHARMACY', queueNumber: 0, calledAt: new Date() },
      });
      const prescription = await tx.prescription.create({
        data: {
          tenantId: me.tenantId,
          visitId: visit.id,
          prescriberId: me.sub,
          alerts: alerts.length ? (alerts as unknown as Prisma.InputJsonValue) : undefined,
          items: {
            create: body.items.map((i) => ({ drugId: i.drugId, dose: 'As directed', frequency: 'PRN', quantity: i.quantity, instructions: i.instructions })),
          },
        },
        include: prescriptionInclude,
      });
      await this.audit.log(me, 'pharmacy.walk-in', 'Prescription', prescription.id, { visitId: visit.id, items: body.items.length, named: !!body.patientId }, tx);
      return prescription;
    });
  }

  private async walkInPatient(tx: Prisma.TransactionClient, tenantId: string) {
    const existing = await tx.patient.findFirst({ where: { tenantId, mrn: WALK_IN_MRN } });
    if (existing) return existing;
    return tx.patient.create({ data: { tenantId, mrn: WALK_IN_MRN, firstName: 'Walk-in', fatherName: 'customer', sex: 'MALE' } });
  }
}

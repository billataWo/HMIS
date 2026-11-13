import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';

const text = (max: number) => z.string().trim().max(max);

const CertificateSchema = z.object({
  type: z.literal('MEDICAL_CERTIFICATE'),
  diagnosis: text(300).min(2, 'Write the diagnosis'),
  restDays: z.number().int().min(0).max(90),
  fromDate: z.iso.date(),
  remarks: text(1000).optional(),
});

const ReferralSchema = z.object({
  type: z.literal('REFERRAL'),
  to: text(200).min(2, 'Say where the patient is referred to'),
  urgency: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']).default('ROUTINE'),
  reason: text(500).min(3, 'Give the reason for referral'),
  summary: text(3000).min(3, 'Summarise the history and findings'),
  treatmentGiven: text(2000).optional(),
});

const DocumentSchema = z.discriminatedUnion('type', [CertificateSchema, ReferralSchema]);

const include = {
  visit: {
    select: {
      id: true,
      checkedInAt: true,
      patient: { select: queuePatientSelect },
      tenant: { select: { name: true, nameAm: true, phone: true, address: true } },
      diagnoses: { select: { icd11Code: true, label: true, isPrimary: true } },
    },
  },
} satisfies Prisma.ClinicalDocumentInclude;

/** Medical (sick-leave) certificates and referral letters issued from a visit, kept for the record. */
@Controller()
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('visits/:id/documents')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async forVisit(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    return this.prisma.client.clinicalDocument.findMany({ where: { visitId: id, tenantId: me.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  @Post('visits/:id/documents')
  @Roles('DOCTOR')
  async create(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(DocumentSchema)) body: z.infer<typeof DocumentSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Visit not found');
    const visit = await this.prisma.client.visit.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!visit) throw new NotFoundException('Visit not found');
    if (visit.status === 'CANCELLED' || visit.status === 'WAITING' || visit.kind !== 'OPD') throw new ConflictException('Documents are issued after the patient has been seen');
    const { type, ...data } = body;
    const doc = await this.prisma.client.clinicalDocument.create({
      data: { tenantId: me.tenantId, visitId: id, type, data: { ...data, issuedBy: me.name }, createdById: me.sub },
    });
    await this.audit.log(me, 'document.issue', 'ClinicalDocument', doc.id, { type, visitId: id });
    return doc;
  }

  @Get('documents/:id')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Document not found');
    const doc = await this.prisma.client.clinicalDocument.findFirst({ where: { id, tenantId: me.tenantId }, include });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}

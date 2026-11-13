import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
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

export const REFERRAL_STATUSES = ['SENT', 'ARRIVED', 'FEEDBACK_RECEIVED', 'DID_NOT_GO'] as const;
const FollowUpSchema = z
  .object({
    status: z.enum(REFERRAL_STATUSES),
    note: text(2000).optional(),
  })
  .refine((b) => (b.status !== 'SENT' && b.status !== 'FEEDBACK_RECEIVED') || (b.note?.length ?? 0) >= 3, {
    message: 'Write what happened (for feedback: what the other facility found and did)',
    path: ['note'],
  });
const ReferralQuerySchema = z.object({ view: z.enum(['open', 'all']).default('open') });

/** A referral not followed up after this many days is overdue: a day for urgent ones, a week otherwise. */
export function referralDueDays(urgency: unknown) {
  return urgency === 'ROUTINE' ? 7 : 1;
}

/** The referral's status: its latest follow-up's, SENT until there is one. */
export function referralStatus(followUps: { status: string; createdAt: Date }[]) {
  return followUps.reduce<{ status: string; createdAt: Date } | null>((l, f) => (!l || f.createdAt >= l.createdAt ? f : l), null)?.status ?? 'SENT';
}

const followUpOrder = { orderBy: { createdAt: 'asc' } } as const;

const include = {
  followUps: followUpOrder,
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
    const docs = await this.prisma.client.clinicalDocument.findMany({ where: { visitId: id, tenantId: me.tenantId }, orderBy: { createdAt: 'desc' }, include: { followUps: followUpOrder } });
    return this.withAuthors(docs);
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
    return (await this.withAuthors([doc]))[0];
  }

  /** Adds who wrote each follow-up and the referral's status. */
  private async withAuthors<T extends { type: string; followUps: { createdById: string; status: string; createdAt: Date }[] }>(docs: T[]) {
    const ids = [...new Set(docs.flatMap((d) => d.followUps.map((f) => f.createdById)))];
    const users = ids.length ? await this.prisma.client.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
    return docs.map((d) => ({
      ...d,
      referralStatus: d.type === 'REFERRAL' ? referralStatus(d.followUps) : null,
      followUps: d.followUps.map((f) => ({ ...f, createdBy: users.find((u) => u.id === f.createdById)?.fullName ?? null })),
    }));
  }

  /**
   * What became of a referral: the patient arrived, the other facility's feedback, they did not go,
   * or a note of a call made. Never changed afterwards; the latest is the referral's status.
   */
  @Post('documents/:id/follow-ups')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async followUp(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(FollowUpSchema)) body: z.infer<typeof FollowUpSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Referral not found');
    const doc = await this.prisma.client.clinicalDocument.findFirst({ where: { id, tenantId: me.tenantId }, select: { type: true, visitId: true } });
    if (!doc) throw new NotFoundException('Referral not found');
    if (doc.type !== 'REFERRAL') throw new ConflictException('Only referrals are followed up');
    const f = await this.prisma.client.referralFollowUp.create({
      data: { tenantId: me.tenantId, documentId: id, status: body.status, note: body.note || null, createdById: me.sub },
    });
    // The fact of it, not its content.
    await this.audit.log(me, 'referral.follow-up', 'ClinicalDocument', id, { status: body.status, visitId: doc.visitId });
    return f;
  }

  /**
   * Referrals out: open ones (sent, or arrived with feedback awaited) from the last year, oldest
   * first, or every referral of the last 90 days, newest first.
   */
  @Get('referrals')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async referrals(@CurrentUser() me: AuthUser, @Query(new ZodPipe(ReferralQuerySchema)) q: z.infer<typeof ReferralQuerySchema>) {
    const today = clinicDay();
    const back = (days: number) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
      return dayRange(d.toISOString().slice(0, 10)).start;
    };
    const docs = await this.prisma.client.clinicalDocument.findMany({
      where: { tenantId: me.tenantId, type: 'REFERRAL', createdAt: { gte: back(q.view === 'open' ? 365 : 90) } },
      orderBy: { createdAt: q.view === 'open' ? 'asc' : 'desc' },
      include: { followUps: followUpOrder, visit: { select: { id: true, checkedInAt: true, patient: { select: queuePatientSelect } } } },
    });
    const now = Date.now();
    const rows = (await this.withAuthors(docs))
      .filter((d) => q.view === 'all' || d.referralStatus === 'SENT' || d.referralStatus === 'ARRIVED')
      .map((d) => {
        const data = d.data as Record<string, unknown>;
        const ageDays = Math.floor((now - d.createdAt.getTime()) / 86_400_000);
        return {
          id: d.id,
          createdAt: d.createdAt,
          visit: d.visit,
          to: data.to,
          urgency: data.urgency,
          reason: data.reason,
          issuedBy: data.issuedBy,
          status: d.referralStatus,
          ageDays,
          // Not heard of since it was sent, past its due time.
          overdue: d.referralStatus === 'SENT' && ageDays >= referralDueDays(data.urgency),
          followUps: d.followUps,
        };
      });
    return rows;
  }
}

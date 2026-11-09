import { randomBytes } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { Body, Controller, Get, HttpCode, HttpException, Logger, NotFoundException, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AllowWhileSuspended } from '../platform/subscription.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AllowOnCloudCopy } from '../sync/read-only.guard.js';
import { exportClinicLines } from './clinic-data.js';

const PasswordSchema = z.object({ password: z.string().min(1).max(200) });

/** Wrong passwords for a clinic export, per admin: 5 in 15 minutes, then a wait. */
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; first: number }>();
/** One-time download tickets (in memory, 2 minutes), so the file itself is a plain GET download. */
const tickets = new Map<string, { userId: string; tenantId: string; until: number; used: boolean }>();

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'clinic';

/**
 * A patient's or the whole clinic's records, to take away: the right of access and data
 * portability (Proclamation 1321/2024), and a clinic that leaves HMIS. Admins only; every export
 * is in the audit log. Possible while the clinic is read-only (it may have left).
 */
@Controller('exports')
@Roles('ADMIN')
export class ExportsController {
  private readonly log = new Logger('Exports');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** One patient's whole record, in a structured, machine-readable form. */
  @Get('patients/:id')
  async patient(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const db = this.prisma.client;
    const who = { select: { fullName: true } };
    const patient = await db.patient.findFirst({
      where: { id, tenantId: me.tenantId },
      include: {
        appointments: { orderBy: { scheduledAt: 'asc' }, include: { doctor: who } },
        visits: {
          orderBy: { checkedInAt: 'asc' },
          include: {
            doctor: who,
            diagnoses: true,
            documents: true,
            prescriptions: { include: { prescriber: who, items: { include: { drug: { select: { genericName: true, strength: true, form: true } } } } } },
            labOrders: {
              include: {
                labTest: { select: { name: true, loincCode: true, unit: true, refLow: true, refHigh: true } },
                values: { include: { component: { select: { name: true, unit: true, refLow: true, refHigh: true } } } },
                orderedBy: who,
                verifiedBy: who,
              },
            },
            charges: true,
          },
        },
        invoices: { orderBy: { createdAt: 'asc' }, include: { charges: true, payments: true, payer: { select: { name: true, type: true } } } },
      },
    });
    if (!patient) throw new NotFoundException();
    const tenant = await db.tenant.findFirstOrThrow({ where: { id: me.tenantId }, select: { name: true, nameAm: true, phone: true, address: true } });
    await this.audit.log(me, 'patient.exported', 'Patient', id, { mrn: patient.mrn });
    return { format: 'hmis-patient-record', version: 1, exportedAt: new Date().toISOString(), clinic: tenant, patient };
  }

  /**
   * Step 1 of downloading the whole clinic: the admin's password again, for a one-time ticket
   * (2 minutes). Step 2 fetches the file with it, as a plain download.
   */
  @Post('clinic/ticket')
  @HttpCode(200)
  @AllowWhileSuspended()
  @AllowOnCloudCopy()
  async ticket(@CurrentUser() me: AuthUser, @Body(new ZodPipe(PasswordSchema)) body: z.infer<typeof PasswordSchema>) {
    const now = Date.now();
    const f = failures.get(me.sub);
    if (f && now - f.first < WINDOW_MS && f.count >= 5) throw new HttpException('Too many wrong passwords. Try again in 15 minutes.', 429);
    const user = await this.prisma.client.user.findFirstOrThrow({ where: { id: me.sub, tenantId: me.tenantId }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(body.password, user.passwordHash))) {
      failures.set(me.sub, !f || now - f.first >= WINDOW_MS ? { count: 1, first: now } : { count: f.count + 1, first: f.first });
      throw new UnauthorizedException('That password is not right');
    }
    failures.delete(me.sub);
    for (const [k, t] of tickets) if (t.until < now) tickets.delete(k);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { userId: me.sub, tenantId: me.tenantId, until: now + 2 * 60_000, used: false });
    return { ticket };
  }

  /**
   * Step 2: the whole clinic, as compressed JSON lines (docs/saas/README.md): every record, which
   * another HMIS server can import. The ticket works for 2 minutes, only with the session of the
   * admin it was given to (browsers may fetch a download twice); the export is logged once.
   */
  @Get('clinic')
  @AllowWhileSuspended()
  async clinic(@CurrentUser() me: AuthUser, @Query('ticket') ticket: string | undefined, @Res() res: Response) {
    const t = ticket ? tickets.get(ticket) : undefined;
    if (!t || t.until < Date.now() || t.userId !== me.sub || t.tenantId !== me.tenantId) throw new UnauthorizedException('Enter your password again to download the data');
    const appUrl = process.env.APP_DATABASE_URL;
    if (!appUrl) throw new HttpException('Exports need the restricted database role (APP_DATABASE_URL).', 503);

    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { name: true } });
    if (!t.used) await this.audit.log(me, 'clinic.exported', 'Tenant', me.tenantId);
    t.used = true;
    const filename = `hmis-${slug(tenant.name)}-${new Date().toISOString().slice(0, 10)}.ndjson.gz`;
    res.setHeader('content-type', 'application/gzip');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    const gzip = createGzip();
    gzip.pipe(res);
    try {
      for await (const line of exportClinicLines(this.prisma.system, appUrl, me.tenantId)) {
        if (!gzip.write(line)) await new Promise((r) => gzip.once('drain', r));
      }
      gzip.end();
    } catch (e) {
      // Headers are sent: the file ends without its "end" line, so an import sees it is incomplete.
      this.log.error(`Clinic export for ${me.tenantId} failed: ${e instanceof Error ? e.message : e}`);
      gzip.destroy();
      res.destroy();
    }
  }
}

import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpException, NotFoundException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { clientIp } from '../common/client-ip.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ethiopianMobile } from './create-clinic.js';
import { platformEnabled } from './platform-auth.js';
import { FEATURES } from './subscription-state.js';

const RequestSchema = z.object({
  clinicName: z.string().trim().min(2).max(120),
  clinicNameAm: z.string().trim().max(120).optional(),
  type: z.enum(['CLINIC', 'PHARMACY', 'HOSPITAL']).default('CLINIC'),
  region: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(200).optional(),
  licenceNumber: z.string().trim().max(60).optional(),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().min(9).max(20),
  contactEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(200)]).optional(),
  planCode: z.string().trim().max(20).optional(),
  staffCount: z.number().int().min(1).max(5000).optional(),
  deployment: z.enum(['CLOUD', 'CLINIC_SERVER', 'ON_PREMISE']).default('CLOUD'),
  message: z.string().trim().max(2000).optional(),
  /** Hidden field on the form: people leave it empty, form-filling robots don't. */
  website: z.string().max(200).optional(),
  /** The requester accepted the Terms of Service and the Privacy Policy of this date (they are shown on the form). */
  termsVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Please accept the terms and the privacy policy'),
});

/** Requests per address: 5 an hour (the form is public). */
const HOUR = 3_600_000;
const sent = new Map<string, number[]>();

/** For the public pages of the HMIS cloud: the plans, and "we would like to use HMIS". */
@Controller('public')
@Public()
export class PublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('plans')
  async plans() {
    if (!platformEnabled()) throw new NotFoundException();
    const plans = await this.prisma.system.plan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { code: true, name: true, description: true, priceMonthly: true, priceYearly: true, maxStaff: true, features: true },
    });
    const settings = await this.prisma.system.platformSetting.findUnique({ where: { id: 1 }, select: { trialDays: true, graceDays: true, vatPercent: true, supportPhone: true, supportEmail: true, dataRetentionDays: true } });
    return { plans, features: FEATURES, ...settings };
  }

  @Post('clinic-requests')
  async request(@Req() req: Request, @Body(new ZodPipe(RequestSchema)) body: z.infer<typeof RequestSchema>) {
    if (!platformEnabled()) throw new NotFoundException();
    const ip = clientIp(req) ?? 'unknown';
    const now = Date.now();
    const recent = (sent.get(ip) ?? []).filter((t) => now - t < HOUR);
    if (recent.length >= 5) throw new HttpException('Too many requests from this address. Please call us instead.', 429);
    sent.set(ip, [...recent, now]);
    if (sent.size > 20_000) for (const [k, v] of sent) if (v.every((t) => now - t > HOUR)) sent.delete(k);

    const phone = ethiopianMobile(body.contactPhone);
    if (!phone) throw new HttpException({ message: 'Validation failed', errors: [{ field: 'contactPhone', message: 'An Ethiopian mobile number (09... or 07...)' }] }, 400);
    const reference = `R-${randomBytes(3).toString('hex').toUpperCase()}`;
    // A robot: looks accepted, nothing is kept.
    if (body.website) return { reference };

    const { website: _w, contactEmail, ...rest } = body;
    await this.prisma.system.clinicRequest.create({ data: { ...rest, contactPhone: phone, contactEmail: contactEmail || null, reference, ip, termsAcceptedAt: new Date() } });
    return { reference };
  }
}

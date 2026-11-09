import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { installLicence, readLicence } from '../licence/licence.js';
import { AllowOnCloudCopy } from '../sync/read-only.guard.js';
import { onlineMethods, settleCheckout, startCheckout } from './payments/checkout.js';
import { FEATURES } from './subscription-state.js';
import { AllowWhileSuspended, forgetSubscription, tenantPlan } from './subscription.guard.js';

const LicenceSchema = z.object({ licence: z.string().trim().min(40).max(20_000) });

const CheckoutSchema = z.object({ provider: z.enum(['CHAPA', 'TELEBIRR']) });

const TransferSchema = z.object({
  reference: z.string().trim().min(4, 'The transaction number on the bank receipt').max(100),
  amount: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), 'An amount like 5750 or 5750.50'),
  paidAt: z.coerce.date(),
});

/** Settings → Subscription: the clinic's plan, its HMIS invoices, and paying them. */
@Controller('subscription')
@Roles('ADMIN')
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AllowWhileSuspended()
  async status(@CurrentUser() me: AuthUser) {
    const plan = await tenantPlan(this.prisma, me.tenantId);
    if (!plan.managed) return { managed: false };
    if (plan.source === 'licence') return this.licenceStatus(me, plan);
    // The clinic's own rows, under row-level security.
    const [sub, invoices, activeStaff, settings] = await Promise.all([
      this.prisma.client.subscription.findFirstOrThrow({ where: { tenantId: me.tenantId }, include: { plan: true } }),
      this.prisma.client.platformInvoice.findMany({ where: { tenantId: me.tenantId }, orderBy: { issuedAt: 'desc' }, take: 24, include: { payments: { orderBy: { createdAt: 'asc' } } } }),
      this.prisma.client.user.count({ where: { tenantId: me.tenantId, active: true } }),
      this.prisma.system.platformSetting.findUnique({ where: { id: 1 }, select: { bankDetails: true, supportPhone: true, supportEmail: true } }),
    ]);
    return {
      ...plan,
      deployment: sub.deployment,
      billingCycle: sub.billingCycle,
      suspendReason: sub.suspendedAt ? sub.suspendReason : null,
      plan: {
        name: sub.plan.name,
        code: sub.plan.code,
        description: sub.plan.description,
        priceMonthly: sub.plan.priceMonthly,
        priceYearly: sub.plan.priceYearly,
        maxStaff: sub.plan.maxStaff,
        features: sub.plan.features.map((f) => ({ code: f, name: FEATURES[f as keyof typeof FEATURES] ?? f })),
      },
      activeStaff,
      invoices: invoices.map((i) => ({
        ...i,
        paid: (i.payments.filter((p) => p.status === 'CONFIRMED').reduce((s, p) => s + toCents(p.amount), 0) / 100).toFixed(2),
      })),
      online: onlineMethods(),
      bankDetails: settings?.bankDetails ?? null,
      support: { phone: settings?.supportPhone ?? null, email: settings?.supportEmail ?? null },
    };
  }

  /**
   * On a clinic server or own-server install: the plan comes from the HMIS licence installed here;
   * HMIS's invoices live in the cloud (a synced clinic's admins pay them there).
   */
  private async licenceStatus(me: AuthUser, plan: Awaited<ReturnType<typeof tenantPlan>>) {
    const [installed, activeStaff] = await Promise.all([
      this.prisma.system.installedLicence.findUnique({ where: { tenantId: me.tenantId } }),
      this.prisma.client.user.count({ where: { tenantId: me.tenantId, active: true } }),
    ]);
    const read = installed ? readLicence(installed.licence) : null;
    const l = read?.ok ? read.licence : null;
    const cloud = process.env.SYNC_CLOUD_URL ? new URL(process.env.SYNC_CLOUD_URL).origin : null;
    return {
      ...plan,
      deployment: l?.deployment ?? (cloud ? 'CLINIC_SERVER' : 'ON_PREMISE'),
      billingCycle: 'MONTHLY',
      suspendReason: null,
      plan: l
        ? { name: l.plan.name, code: l.plan.code, description: null, priceMonthly: null, priceYearly: null, maxStaff: l.plan.maxStaff, features: l.plan.features.map((f) => ({ code: f, name: FEATURES[f as keyof typeof FEATURES] ?? f })) }
        : null,
      activeStaff,
      invoices: [],
      online: { CHAPA: false, TELEBIRR: false },
      bankDetails: null,
      support: { phone: null, email: null },
      licence: installed && l ? { id: l.id, issuedAt: l.issuedAt, source: installed.source, installedAt: installed.installedAt, clinicName: l.clinicName } : null,
      // A synced clinic server renews its licence by itself; its admins pay HMIS in the cloud.
      payAt: cloud ? `${cloud}/settings/subscription` : null,
    };
  }

  /** An HMIS licence file, on a server outside the cloud. */
  @Post('licence')
  @AllowWhileSuspended()
  async licence(@CurrentUser() me: AuthUser, @Body(new ZodPipe(LicenceSchema)) body: z.infer<typeof LicenceSchema>) {
    const { licence, changed } = await installLicence(this.prisma.system, body.licence, 'upload', me.tenantId);
    forgetSubscription(me.tenantId);
    if (changed) await this.audit.log(me, 'licence.installed', 'InstalledLicence', licence.id, { plan: licence.plan.code, endsAt: licence.endsAt, issuedAt: licence.issuedAt });
    return { ok: true, changed, plan: licence.plan.name, endsAt: licence.endsAt };
  }

  /** Pays what is left of an invoice online: returns the provider's payment page. */
  @Post('invoices/:id/checkout')
  @AllowWhileSuspended()
  @AllowOnCloudCopy()
  async checkout(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const payer = await this.prisma.client.user.findFirstOrThrow({ where: { id: me.sub, tenantId: me.tenantId }, select: { id: true, fullName: true, phone: true, email: true } });
    const result = await startCheckout(this.prisma.system, { invoiceId: id, tenantId: me.tenantId, provider: body.provider, payer });
    await this.audit.log(me, 'subscription.checkout', 'PlatformCheckout', result.reference, { provider: body.provider, invoice: id });
    return result;
  }

  /** Back from the payment page: asks the provider, and records the payment if it went through. */
  @Post('checkouts/:reference/check')
  @AllowWhileSuspended()
  @AllowOnCloudCopy()
  async check(@CurrentUser() me: AuthUser, @Param('reference') reference: string) {
    const checkout = await this.prisma.system.platformCheckout.findFirst({ where: { reference, tenantId: me.tenantId } });
    if (!checkout) throw new NotFoundException();
    const done = await settleCheckout(this.prisma.system, reference);
    const invoice = await this.prisma.client.platformInvoice.findFirst({ where: { id: done.invoiceId }, select: { number: true, status: true } });
    return { status: done.status, provider: done.provider, amount: done.amount, applied: !!done.paymentId, invoice };
  }

  /** "We paid by bank transfer": HMIS checks its statement and confirms it. */
  @Post('invoices/:id/bank-transfer')
  @AllowWhileSuspended()
  @AllowOnCloudCopy()
  async bankTransfer(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(TransferSchema)) body: z.infer<typeof TransferSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const invoice = await this.prisma.client.platformInvoice.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!invoice) throw new NotFoundException();
    if (invoice.status !== 'OPEN') throw new ConflictException(`Invoice ${invoice.number} is ${invoice.status.toLowerCase()}`);
    if (toCents(body.amount) <= 0) throw new ConflictException('Enter the amount transferred');
    // The application role only reads payments: reported through the owner connection.
    if (await this.prisma.system.platformPayment.findFirst({ where: { method: 'BANK_TRANSFER', reference: body.reference } })) {
      throw new ConflictException('This transaction number has already been reported');
    }
    const payment = await this.prisma.system.platformPayment.create({
      data: { invoiceId: invoice.id, tenantId: me.tenantId, amount: body.amount, method: 'BANK_TRANSFER', status: 'PENDING', reference: body.reference, paidAt: body.paidAt, reportedById: me.sub },
    });
    await this.audit.log(me, 'subscription.payment_reported', 'PlatformPayment', payment.id, { invoice: invoice.number, amount: body.amount, reference: body.reference });
    return payment;
  }
}

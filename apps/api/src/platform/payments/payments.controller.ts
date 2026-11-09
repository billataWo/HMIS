import { Body, Controller, Get, Headers, HttpCode, Logger, NotFoundException, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../auth/auth.decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { platformEnabled } from '../platform-auth.js';
import { chapaConfig, chapaWebhookValid } from './chapa.js';
import { settleCheckout } from './checkout.js';
import { telebirrConfig, telebirrVerify } from './telebirr.js';

const REFERENCE = /^HMIS[0-9A-F]{6,40}$/;

/**
 * Where Chapa and Telebirr tell us about payments (reachable from the internet through Caddy:
 * /public/payments/*). Each one only makes us ask the provider about a checkout we started; what
 * they send is never taken as proof of payment.
 */
@Controller('public/payments')
@Public()
export class PaymentsController {
  private readonly log = new Logger('Payments');

  constructor(private readonly prisma: PrismaService) {}

  private async settle(reference: unknown) {
    if (typeof reference !== 'string' || !REFERENCE.test(reference)) return;
    try {
      await settleCheckout(this.prisma.system, reference);
    } catch (e) {
      if (!(e instanceof NotFoundException)) this.log.error(`Settling ${reference}: ${e instanceof Error ? e.message : e}`);
    }
  }

  private enabled(configured: unknown) {
    if (!platformEnabled() || !configured) throw new NotFoundException();
  }

  /** Chapa's callback_url: a GET when a payment completes. */
  @Get('chapa/callback')
  async chapaCallback(@Query('trx_ref') trxRef?: string, @Query('tx_ref') txRef?: string) {
    this.enabled(chapaConfig());
    await this.settle(trxRef ?? txRef);
    return { ok: true };
  }

  /** Chapa's webhook (set it in the Chapa dashboard): signed with the webhook secret. */
  @Post('chapa/webhook')
  @HttpCode(200)
  async chapaWebhook(@Body() body: { tx_ref?: string; event?: string }, @Headers() headers: Record<string, string>) {
    this.enabled(chapaConfig());
    if (!chapaWebhookValid(body, headers)) throw new UnauthorizedException();
    await this.settle(body?.tx_ref);
    return { ok: true };
  }

  /** Telebirr's notify_url. Checked with Telebirr's public key when it is set. */
  @Post('telebirr/notify')
  @HttpCode(200)
  async telebirrNotify(@Body() body: Record<string, unknown>) {
    const cfg = telebirrConfig();
    this.enabled(cfg);
    if (cfg!.publicKey && !telebirrVerify(body ?? {}, cfg!.publicKey)) throw new UnauthorizedException();
    await this.settle(body?.merch_order_id);
    return { code: '0', msg: 'success' };
  }
}

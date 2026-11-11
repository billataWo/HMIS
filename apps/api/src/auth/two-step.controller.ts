import { currentPasswordMatches } from '../common/password-check.js';
import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AllowWhileSuspended } from '../platform/subscription.guard.js';
import { AllowTwoStepSetup, type AuthUser, CurrentUser, AllStaff } from './auth.decorators.js';
import { forgetAccount } from './auth.guard.js';
import { hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUri, verifyTotp } from './totp.js';

const SetupSchema = z.object({ password: z.string().max(200).optional() });
const CodeSchema = z.object({ code: z.string().trim().min(6).max(10) });
const PasswordSchema = z.object({ password: z.string().min(1).max(200) });

/**
 * Two-step sign-in for one's own account: an authenticator app (codes that change every 30
 * seconds) plus one-time recovery codes for a lost phone. Required for admins (AuthGuard keeps an
 * admin without it on these pages); any other role may turn it on.
 */
@Controller('auth/two-step')
// Securing an account is never blocked by an unpaid bill.
@AllowWhileSuspended()
export class TwoStepController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  private async user(me: AuthUser) {
    const user = await this.prisma.client.user.findFirst({ where: { id: me.sub, tenantId: me.tenantId }, include: { tenant: { select: { name: true } } } });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @AllStaff()
  @Get()
  @AllowTwoStepSetup()
  async status(@CurrentUser() me: AuthUser) {
    const user = await this.user(me);
    return { enabled: !!user.totpEnabledAt, enabledAt: user.totpEnabledAt, required: user.role === 'ADMIN', recoveryCodesLeft: user.totpRecoveryCodes.length };
  }

  /**
   * A new secret for the authenticator app (shown as a QR code). Moving to a new phone when it is
   * already on needs the password: a stolen session must not be able to move it to another phone.
   */
  @AllStaff()
  @Post('setup')
  @HttpCode(200)
  @AllowTwoStepSetup()
  async setup(@CurrentUser() me: AuthUser, @Body(new ZodPipe(SetupSchema)) body: z.infer<typeof SetupSchema>) {
    const user = await this.user(me);
    if (user.totpEnabledAt && !(await currentPasswordMatches(user.id, body.password, user.passwordHash))) {
      throw new UnauthorizedException('Enter your password to move two-step sign-in to a new phone');
    }
    const secret = newSecret();
    await this.prisma.client.user.update({ where: { id: user.id }, data: { totpPendingSecret: secret } });
    return { secret, uri: otpauthUri(secret, `${user.fullName} (${user.tenant.name})`, 'HMIS') };
  }

  /**
   * The first code from the app confirms it is set up. Returns the recovery codes (shown once) and
   * a fresh sign-in: every other sign-in of the account ends now.
   */
  @AllStaff()
  @Post('enable')
  @HttpCode(200)
  @AllowTwoStepSetup()
  async enable(@CurrentUser() me: AuthUser, @Body(new ZodPipe(CodeSchema)) body: z.infer<typeof CodeSchema>) {
    const user = await this.user(me);
    if (!user.totpPendingSecret) throw new ConflictException('Start the setup first');
    const step = verifyTotp(user.totpPendingSecret, body.code, null);
    if (step === null) throw new ConflictException('That code is not right. Check that the phone shows the current time and try the newest code.');
    const codes = newRecoveryCodes();
    const updated = await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        totpSecret: user.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
        totpRecoveryCodes: codes.map(hashRecoveryCode),
        sessionsValidAfter: new Date(),
      },
    });
    forgetAccount(user.id);
    await this.audit.log(me, 'user.two_step_enabled', 'User', user.id);
    const token = await this.jwt.signAsync({ sub: updated.id, tenantId: updated.tenantId, role: updated.role, name: updated.fullName } satisfies AuthUser);
    return { recoveryCodes: codes, token };
  }

  /** New recovery codes (the old ones stop working); needs a current code from the app. */
  @AllStaff()
  @Post('recovery-codes')
  @HttpCode(200)
  async recoveryCodes(@CurrentUser() me: AuthUser, @Body(new ZodPipe(CodeSchema)) body: z.infer<typeof CodeSchema>) {
    const user = await this.user(me);
    if (!user.totpSecret) throw new ConflictException('Two-step sign-in is not on');
    const step = verifyTotp(user.totpSecret, body.code, user.totpLastStep);
    if (step === null) throw new ConflictException('That code is not right');
    const codes = newRecoveryCodes();
    await this.prisma.client.user.update({ where: { id: user.id }, data: { totpLastStep: step, totpRecoveryCodes: codes.map(hashRecoveryCode) } });
    await this.audit.log(me, 'user.two_step_codes', 'User', user.id);
    return { recoveryCodes: codes };
  }

  /** Turning it off needs the password, and is not possible for admins (they must use it). */
  @AllStaff()
  @Post('disable')
  @HttpCode(200)
  async disable(@CurrentUser() me: AuthUser, @Body(new ZodPipe(PasswordSchema)) body: z.infer<typeof PasswordSchema>) {
    const user = await this.user(me);
    if (user.role === 'ADMIN') throw new ForbiddenException('Admins must use two-step sign-in');
    if (!(await currentPasswordMatches(user.id, body.password, user.passwordHash))) throw new UnauthorizedException('Your password is not correct');
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryCodes: [] },
    });
    forgetAccount(user.id);
    await this.audit.log(me, 'user.two_step_disabled', 'User', user.id);
    return { ok: true };
  }
}

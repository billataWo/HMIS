import { DUMMY_HASH, hashPassword, needsRehash, temporaryPasswordExpired } from '../common/passwords.js';
import { Body, ConflictException, Controller, Get, HttpCode, HttpException, Logger, NotFoundException, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { z } from 'zod';
import type { PlatformUser } from '@hmis/db';
import { Public } from '../auth/auth.decorators.js';
import { hashRecoveryCode, looksLikeRecoveryCode, newRecoveryCodes, newSecret, otpauthUri, verifyTotp } from '../auth/totp.js';
import { clientIp } from '../common/client-ip.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentOperator, forgetOperator, type Operator, PlatformAllowPending, platformEnabled, PlatformGuard, platformSecret } from './platform-auth.js';

const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });
const CodeLoginSchema = z.object({ challenge: z.string().min(20).max(2000), code: z.string().trim().min(6).max(20) });
const PasswordSchema = z
  .object({ current: z.string().min(1), next: z.string().min(12, 'Operators need a password of at least 12 characters').max(200) })
  .refine((b) => b.next !== b.current, { message: 'Choose a password different from the current one', path: ['next'] });
const CodeSchema = z.object({ code: z.string().trim().min(6).max(6) });
/** Moving two-step sign-in to another phone needs the password; the first setup does not. */
const SetupSchema = z.object({ password: z.string().max(200).optional() });

/**
 * Wrong passwords and codes for operators, in memory: 5 per account and 20 per address in 15
 * minutes, then 15 minutes' wait. Operators can see every clinic: stricter than for clinic staff.
 */
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; first: number; lockedUntil?: number }>();
function locked(keys: string[]) {
  const now = Date.now();
  return keys.some((k) => (failures.get(k)?.lockedUntil ?? 0) > now);
}
function fail(keys: [string, number][]) {
  const now = Date.now();
  for (const [key, max] of keys) {
    const f = failures.get(key);
    const entry = !f || now - f.first > WINDOW_MS || (f.lockedUntil && f.lockedUntil <= now) ? { count: 0, first: now } : f;
    entry.count += 1;
    if (entry.count >= max && !entry.lockedUntil) entry.lockedUntil = now + WINDOW_MS;
    failures.set(key, entry);
  }
}
const TOO_MANY = () => new HttpException('Too many wrong attempts. Try again in 15 minutes.', 429);

@Controller('platform/auth')
@Public()
export class PlatformAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private readonly log = new Logger('Platform');

  private session(op: Pick<PlatformUser, 'id'>) {
    return this.jwt.signAsync({ sub: op.id, kind: 'platform' }, { secret: platformSecret(), expiresIn: '8h' });
  }

  private audit(operatorId: string | null, action: string, data: Record<string, unknown>, ip: string | null) {
    return this.prisma.system.platformAuditLog
      .create({ data: { operatorId, action, entity: 'PlatformUser', entityId: operatorId, data: data as never, ip } })
      .catch((e: Error) => this.log.error(`Could not record ${action}: ${e.message}`));
  }

  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request, @Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    if (!platformEnabled()) throw new NotFoundException();
    const ip = clientIp(req);
    const keys = [`email:${body.email}`, `ip:${ip ?? 'unknown'}`];
    if (locked(keys)) throw TOO_MANY();
    const op = await this.prisma.system.platformUser.findUnique({ where: { email: body.email } });
    const ok = await bcrypt.compare(body.password, op?.passwordHash ?? DUMMY_HASH);
    if (!op || !ok || !op.active) {
      fail([[keys[0], 5], [keys[1], 20]]);
      await this.audit(op?.id ?? null, 'platform.login_failed', { email: body.email }, ip);
      throw new UnauthorizedException('Wrong email or password');
    }
    if (temporaryPasswordExpired(op)) {
      await this.audit(op.id, 'platform.temporary_password_expired', {}, ip);
      throw new UnauthorizedException('This temporary password has expired. Ask an owner for a new one.');
    }
    if (needsRehash(op.passwordHash)) {
      await this.prisma.system.platformUser.update({ where: { id: op.id }, data: { passwordHash: await hashPassword(body.password) } });
    }
    if (op.totpEnabledAt) {
      const challenge = await this.jwt.signAsync({ sub: op.id, kind: 'platform', purpose: 'two-step' }, { secret: platformSecret(), expiresIn: '5m' });
      return { twoStepRequired: true, challenge };
    }
    // No two-step yet (a new operator): the session can only change the password and set it up.
    await this.prisma.system.platformUser.update({ where: { id: op.id }, data: { lastSignInAt: new Date() } });
    await this.audit(op.id, 'platform.login', { twoStep: false }, ip);
    return { token: await this.session(op) };
  }

  @Post('login/two-step')
  @HttpCode(200)
  async loginCode(@Req() req: Request, @Body(new ZodPipe(CodeLoginSchema)) body: z.infer<typeof CodeLoginSchema>) {
    if (!platformEnabled()) throw new NotFoundException();
    let claims: { sub: string; kind?: string; purpose?: string };
    try {
      claims = await this.jwt.verifyAsync(body.challenge, { secret: platformSecret() });
    } catch {
      throw new UnauthorizedException('The sign-in took too long: start again');
    }
    if (claims.kind !== 'platform' || claims.purpose !== 'two-step') throw new UnauthorizedException();
    const ip = clientIp(req);
    const keys = [`code:${claims.sub}`];
    if (locked(keys)) throw TOO_MANY();
    const op = await this.prisma.system.platformUser.findUnique({ where: { id: claims.sub } });
    if (!op?.active || !op.totpSecret) throw new UnauthorizedException();

    let method: 'app' | 'recovery-code' | null = null;
    if (looksLikeRecoveryCode(body.code)) {
      const hash = hashRecoveryCode(body.code);
      const used = await this.prisma.system.platformUser.updateMany({
        where: { id: op.id, totpRecoveryCodes: { has: hash } },
        data: { totpRecoveryCodes: op.totpRecoveryCodes.filter((h) => h !== hash) },
      });
      if (used.count) method = 'recovery-code';
    } else {
      const step = verifyTotp(op.totpSecret, body.code, op.totpLastStep);
      // Each code works once, even if two sign-ins race with it.
      if (step !== null) {
        const won = await this.prisma.system.platformUser.updateMany({
          where: { id: op.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
          data: { totpLastStep: step },
        });
        if (won.count) method = 'app';
      }
    }
    if (!method) {
      fail([[keys[0], 5]]);
      await this.audit(op.id, 'platform.two_step_failed', {}, ip);
      throw new UnauthorizedException('That code is not right');
    }
    await this.prisma.system.platformUser.update({ where: { id: op.id }, data: { lastSignInAt: new Date() } });
    await this.audit(op.id, 'platform.login', { twoStep: method }, ip);
    return { token: await this.session(op) };
  }

  @Get('me')
  @UseGuards(PlatformGuard)
  @PlatformAllowPending()
  async me(@CurrentOperator() me: Operator) {
    const op = await this.prisma.system.platformUser.findUniqueOrThrow({ where: { id: me.sub } });
    return {
      id: op.id,
      fullName: op.fullName,
      email: op.email,
      role: op.role,
      mustChangePassword: op.mustChangePassword,
      twoStep: { enabled: !!op.totpEnabledAt, recoveryCodesLeft: op.totpRecoveryCodes.length },
    };
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(PlatformGuard)
  @PlatformAllowPending()
  async password(@Req() req: Request, @CurrentOperator() me: Operator, @Body(new ZodPipe(PasswordSchema)) body: z.infer<typeof PasswordSchema>) {
    const op = await this.prisma.system.platformUser.findUniqueOrThrow({ where: { id: me.sub } });
    // Someone with a stolen session must not be able to guess the password from here.
    const key = `password:${op.id}`;
    if (locked([key])) throw TOO_MANY();
    if (!(await bcrypt.compare(body.current, op.passwordHash))) {
      fail([[key, 5]]);
      await this.audit(op.id, 'platform.password_check_failed', {}, clientIp(req));
      throw new ConflictException('The current password is not right');
    }
    await this.prisma.system.platformUser.update({
      where: { id: op.id },
      data: { passwordHash: await hashPassword(body.next), mustChangePassword: false, temporaryPasswordExpiresAt: null, sessionsValidAfter: new Date() },
    });
    forgetOperator(op.id);
    await this.audit(op.id, 'platform.password_changed', {}, clientIp(req));
    return { ok: true, token: await this.session(op) };
  }

  /** A new key for the authenticator app (replacing the current one needs the password). */
  @Post('two-step/setup')
  @HttpCode(200)
  @UseGuards(PlatformGuard)
  @PlatformAllowPending()
  async setup(@Req() req: Request, @CurrentOperator() me: Operator, @Body(new ZodPipe(SetupSchema)) body: z.infer<typeof SetupSchema>) {
    const op = await this.prisma.system.platformUser.findUniqueOrThrow({ where: { id: me.sub } });
    if (op.totpEnabledAt) {
      const key = `password:${op.id}`;
      if (locked([key])) throw TOO_MANY();
      if (!(typeof body?.password === 'string' && (await bcrypt.compare(body.password, op.passwordHash)))) {
        if (typeof body?.password === 'string' && body.password) {
          fail([[key, 5]]);
          await this.audit(op.id, 'platform.password_check_failed', { for: 'two-step setup' }, clientIp(req));
        }
        throw new ConflictException('Enter your password to move two-step sign-in to another phone');
      }
    }
    const secret = newSecret();
    await this.prisma.system.platformUser.update({ where: { id: op.id }, data: { totpPendingSecret: secret } });
    return { secret, uri: otpauthUri(secret, op.email, 'HMIS platform') };
  }

  @Post('two-step/enable')
  @HttpCode(200)
  @UseGuards(PlatformGuard)
  @PlatformAllowPending()
  async enable(@Req() req: Request, @CurrentOperator() me: Operator, @Body(new ZodPipe(CodeSchema)) body: z.infer<typeof CodeSchema>) {
    const op = await this.prisma.system.platformUser.findUniqueOrThrow({ where: { id: me.sub } });
    if (!op.totpPendingSecret) throw new ConflictException('Start the setup first');
    const step = verifyTotp(op.totpPendingSecret, body.code, null);
    if (step === null) throw new ConflictException('That code is not right. Check that the phone shows the current time and try the newest code.');
    const codes = newRecoveryCodes();
    await this.prisma.system.platformUser.update({
      where: { id: op.id },
      data: {
        totpSecret: op.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
        totpRecoveryCodes: codes.map(hashRecoveryCode),
        sessionsValidAfter: new Date(),
      },
    });
    forgetOperator(op.id);
    await this.audit(op.id, 'platform.two_step_enabled', {}, clientIp(req));
    return { recoveryCodes: codes, token: await this.session(op) };
  }
}

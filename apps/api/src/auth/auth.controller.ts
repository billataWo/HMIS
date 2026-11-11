import { currentPasswordMatches } from '../common/password-check.js';
import { DUMMY_HASH, hashPassword, needsRehash, temporaryPasswordExpired } from '../common/passwords.js';
import { Body, Controller, Get, HttpCode, HttpException, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Request } from 'express';
import { AuditService } from '../common/audit.service.js';
import { clientIp } from '../common/client-ip.js';
import { normalizePhone } from '../common/phone.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AllowWhileSuspended, tenantPlan } from '../platform/subscription.guard.js';
import { AllowPendingPassword, AllowTwoStepSetup, type AuthUser, CurrentUser, Public, AllStaff } from './auth.decorators.js';
import { hashRecoveryCode, looksLikeRecoveryCode, verifyTotp } from './totp.js';
import { forgetAccount } from './auth.guard.js';

const LoginSchema = z.object({
  phone: z.string().min(9),
  password: z.string().min(1),
  facilityId: z.uuid().optional(), // needed only when one phone has accounts at several facilities
});

const TwoStepLoginSchema = z.object({
  challenge: z.string().min(20).max(2000),
  code: z.string().trim().min(6).max(20), // 6 digits from the app, or a recovery code
});

/** Wrong two-step codes per account: after 5 within 15 minutes, that account waits 15 minutes. */
const MAX_CODE_FAILURES = 5;
const codeFailures = new Map<string, { count: number; first: number; lockedUntil?: number }>();

const PasswordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password'),
    next: z.string().min(8, 'The new password must be at least 8 characters').max(200),
  })
  .refine((b) => b.next !== b.current, { message: 'Choose a password different from the current one', path: ['next'] });

// Compared against when the phone is unknown, so response time doesn't reveal which phones have accounts.

/**
 * Wrong-password limits, in memory (per API process), each counted over WINDOW_MS and then locked
 * for WINDOW_MS:
 *  - one account from one address: 5 tries (someone guessing a password)
 *  - one account from everywhere: 20 tries (a guessing attack spread over many addresses); higher,
 *    so one person mistyping can't lock a colleague out
 *  - one address against any accounts: 30 tries (one password tried on every staff phone)
 */
const WINDOW_MS = 15 * 60_000;
const LIMITS = { accountFromAddress: 5, account: 20, address: 30 } as const;
const failures = new Map<string, { count: number; first: number; lockedUntil?: number }>();

function lockedFor(key: string) {
  const f = failures.get(key);
  return f?.lockedUntil && f.lockedUntil > Date.now() ? f.lockedUntil - Date.now() : 0;
}

/** Throws 429 when any limit that applies is reached. */
function checkLocks(phone: string, ip: string | null) {
  // Address unknown (came through the web app without one): the 5-try limit applies to all callers.
  const keys = [`phone:${phone}`, `pair:${phone}|${ip ?? 'unknown'}`, ...(ip ? [`ip:${ip}`] : [])];
  const wait = Math.max(...keys.map(lockedFor));
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    throw new HttpException(`Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an admin to reset it.`, 429);
  }
}

/** Counts a failure against every limit; returns the limits that have just locked. */
function recordFailure(phone: string, ip: string | null): string[] {
  const now = Date.now();
  const locked: string[] = [];
  const bump = (key: string, max: number, name: string) => {
    const f = failures.get(key);
    const entry = !f || now - f.first > WINDOW_MS || (f.lockedUntil && f.lockedUntil <= now) ? { count: 0, first: now } : f;
    entry.count += 1;
    if (entry.count >= max && !entry.lockedUntil) {
      entry.lockedUntil = now + WINDOW_MS;
      locked.push(name);
    }
    failures.set(key, entry);
  };
  bump(`phone:${phone}`, LIMITS.account, 'account');
  bump(`pair:${phone}|${ip ?? 'unknown'}`, LIMITS.accountFromAddress, 'account from this address');
  if (ip) bump(`ip:${ip}`, LIMITS.address, 'address');
  // Keep the map from growing without end under an attack from many addresses.
  if (failures.size > 50_000) for (const [k, v] of failures) if (now - v.first > WINDOW_MS && !(v.lockedUntil && v.lockedUntil > now)) failures.delete(k);
  return locked;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  private readonly log = new Logger('Auth');

  /**
   * Sign-ins are part of the audit log (who signed in, from where, failed attempts and lockouts),
   * in the clinic of the account concerned. Written with the owner connection: there is no
   * signed-in clinic yet. Never blocks the sign-in itself.
   */
  private async auditSignIn(tenantId: string, userId: string, action: string, data: Record<string, unknown>) {
    await this.prisma.system.auditLog
      .create({ data: { tenantId, userId, action, entity: 'User', entityId: userId, data: data as never } })
      .catch((e: Error) => this.log.error(`Could not record ${action}: ${e.message}`));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request, @Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    const phone = normalizePhone(body.phone);
    const ip = clientIp(req);
    checkLocks(phone, ip);
    // Sign-in happens before we know the clinic, so this one lookup uses the owner connection.
    const candidates = await this.prisma.system.user.findMany({
      where: {
        phone,
        active: true,
        ...(body.facilityId ? { tenantId: body.facilityId } : {}),
      },
      include: { tenant: { select: { id: true, name: true, nameAm: true } } },
    });

    let user: (typeof candidates)[number] | undefined;
    for (const c of candidates) {
      if (await bcrypt.compare(body.password, c.passwordHash)) {
        user = c;
        break;
      }
    }
    if (!candidates.length) await bcrypt.compare(body.password, DUMMY_HASH);
    if (!user) {
      const locked = recordFailure(phone, ip);
      for (const c of candidates) {
        await this.auditSignIn(c.tenantId, c.id, 'auth.login_failed', { ip });
        if (locked.length) await this.auditSignIn(c.tenantId, c.id, 'auth.locked', { ip, limits: locked });
      }
      throw new UnauthorizedException('Wrong phone number or password');
    }
    if (temporaryPasswordExpired(user)) {
      await this.auditSignIn(user.tenantId, user.id, 'auth.temporary_password_expired', { ip });
      throw new UnauthorizedException('This temporary password has expired. Ask your clinic administrator for a new one.');
    }
    failures.delete(`phone:${phone}`);
    failures.delete(`pair:${phone}|${ip ?? 'unknown'}`);
    // An older, weaker hash is replaced now, while the password is at hand.
    if (needsRehash(user.passwordHash)) {
      await this.prisma.system.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.password) } });
    }

    // Two-step sign-in: the password was right; the session comes after the code. The challenge
    // is a short-lived token that the guard never accepts as a session (it carries a purpose).
    if (user.totpEnabledAt && user.totpSecret) {
      const challenge = await this.jwt.signAsync({ sub: user.id, tenantId: user.tenantId, purpose: 'two-step' }, { expiresIn: '5m' });
      return { twoStepRequired: true, challenge, facility: user.tenant };
    }
    await this.auditSignIn(user.tenantId, user.id, 'auth.login', { ip });
    return this.session(user);
  }

  private async session(user: { id: string; tenantId: string; role: AuthUser['role']; fullName: string; mustChangePassword: boolean; tenant: unknown }) {
    const payload: AuthUser = { sub: user.id, tenantId: user.tenantId, role: user.role, name: user.fullName };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: user.id, fullName: user.fullName, role: user.role },
      facility: user.tenant,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /** The second step: the code from the authenticator app (or a one-time recovery code). */
  @Public()
  @Post('login/two-step')
  @HttpCode(200)
  async loginTwoStep(@Req() req: Request, @Body(new ZodPipe(TwoStepLoginSchema)) body: z.infer<typeof TwoStepLoginSchema>) {
    const ip = clientIp(req);
    let claims: { sub: string; tenantId: string; purpose?: string };
    try {
      claims = await this.jwt.verifyAsync(body.challenge);
    } catch {
      throw new UnauthorizedException({ message: 'The sign-in took too long: enter your password again', code: 'CHALLENGE_EXPIRED' });
    }
    if (claims.purpose !== 'two-step') throw new UnauthorizedException();

    const f = codeFailures.get(claims.sub);
    if (f?.lockedUntil && f.lockedUntil > Date.now()) {
      throw new HttpException(`Too many wrong codes. Try again in ${Math.ceil((f.lockedUntil - Date.now()) / 60_000)} minutes, or ask an admin to reset your two-step sign-in.`, 429);
    }
    // No clinic is signed in yet: the owner connection, by primary key.
    const user = await this.prisma.system.user.findUnique({ where: { id: claims.sub }, include: { tenant: { select: { id: true, name: true, nameAm: true } } } });
    if (!user || !user.active || user.tenantId !== claims.tenantId || !user.totpSecret) throw new UnauthorizedException();

    let method: 'app' | 'recovery code' | null = null;
    const step = verifyTotp(user.totpSecret, body.code, user.totpLastStep);
    if (step !== null) {
      // Only if nobody used this step meanwhile (two sign-ins racing with the same code).
      const used = await this.prisma.system.user.updateMany({
        where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      if (used.count) method = 'app';
    } else if (looksLikeRecoveryCode(body.code)) {
      const hash = hashRecoveryCode(body.code);
      if (user.totpRecoveryCodes.includes(hash)) {
        // Used up only if it is still there: a code works once, even for two sign-ins at once.
        const used = await this.prisma.system.user.updateMany({
          where: { id: user.id, totpRecoveryCodes: { has: hash } },
          data: { totpRecoveryCodes: user.totpRecoveryCodes.filter((h) => h !== hash) },
        });
        if (used.count) method = 'recovery code';
      }
    }

    if (!method) {
      const now = Date.now();
      const entry = !f || now - f.first > 15 * 60_000 || (f.lockedUntil && f.lockedUntil <= now) ? { count: 0, first: now } : f;
      entry.count += 1;
      if (entry.count >= MAX_CODE_FAILURES) entry.lockedUntil = now + 15 * 60_000;
      codeFailures.set(claims.sub, entry);
      await this.auditSignIn(user.tenantId, user.id, entry.lockedUntil ? 'auth.locked' : 'auth.two_step_failed', { ip, ...(entry.lockedUntil && { limits: ['two-step code'] }) });
      throw new UnauthorizedException('That code is not right. Use the current code from your authenticator app.');
    }
    codeFailures.delete(claims.sub);
    await this.auditSignIn(user.tenantId, user.id, 'auth.login', { ip, twoStep: method, ...(method === 'recovery code' && { recoveryCodesLeft: user.totpRecoveryCodes.length - 1 }) });
    return this.session(user);
  }

  /** Any signed-in user changes their own password (and so replaces a temporary one). */
  @AllStaff()
  @Post('password')
  @HttpCode(200)
  @AllowPendingPassword()
  @AllowTwoStepSetup()
  @AllowWhileSuspended()
  async changePassword(@CurrentUser() me: AuthUser, @Body(new ZodPipe(PasswordSchema)) body: z.infer<typeof PasswordSchema>) {
    const user = await this.prisma.client.user.findFirst({ where: { id: me.sub, tenantId: me.tenantId } });
    if (!user || !(await currentPasswordMatches(user.id, body.current, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is not correct');
    }
    // Every other sign-in of this account stops working (a stolen one included); this one gets a
    // fresh token, issued after the cut-off.
    const updated = await this.prisma.client.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.next), mustChangePassword: false, temporaryPasswordExpiresAt: null, sessionsValidAfter: new Date() },
    });
    forgetAccount(user.id);
    await this.audit.log(me, 'user.password', 'User', user.id);
    const payload: AuthUser = { sub: updated.id, tenantId: updated.tenantId, role: updated.role, name: updated.fullName };
    return { ok: true, token: await this.jwt.signAsync(payload) };
  }

  @AllStaff()
  @Get('me')
  @AllowPendingPassword()
  @AllowTwoStepSetup()
  async me(@CurrentUser() me: AuthUser) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: me.sub, tenantId: me.tenantId, active: true },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        mustChangePassword: true,
        totpEnabledAt: true,
        // The screens use this to show or hide "Register patient" for doctors.
        tenant: { select: { id: true, name: true, nameAm: true, doctorsCanRegister: true } },
      },
    });
    if (!user) throw new UnauthorizedException();
    const { totpEnabledAt, ...rest } = user;
    const plan = await tenantPlan(this.prisma, me.tenantId);
    return {
      ...rest,
      twoStep: { enabled: !!totpEnabledAt, required: user.role === 'ADMIN' },
      // null: every module. The screens hide what the plan does not include.
      features: plan.features,
      subscription: plan.managed
        ? { state: plan.state, readOnly: plan.readOnly, daysLeft: plan.daysLeft, endsAt: plan.endsAt, planName: plan.planName, source: plan.source, unlicensed: !!plan.unlicensed }
        : null,
    };
  }
}

import { Body, Controller, Get, HttpCode, HttpException, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../common/audit.service.js';
import { normalizePhone } from '../common/phone.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AllowPendingPassword, type AuthUser, CurrentUser, Public } from './auth.decorators.js';
import { forgetAccount } from './auth.guard.js';

const LoginSchema = z.object({
  phone: z.string().min(9),
  password: z.string().min(1),
  facilityId: z.uuid().optional(), // needed only when one phone has accounts at several facilities
});

const PasswordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password'),
    next: z.string().min(8, 'The new password must be at least 8 characters').max(200),
  })
  .refine((b) => b.next !== b.current, { message: 'Choose a password different from the current one', path: ['next'] });

// Compared against when the phone is unknown, so response time doesn't reveal which phones have accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/**
 * Wrong-password limit per phone number: after MAX_FAILURES within WINDOW_MS the number is locked
 * for WINDOW_MS. In memory, so it is per API process (enough for a single clinic server).
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; first: number; lockedUntil?: number }>();

function checkLock(phone: string) {
  const f = failures.get(phone);
  if (f?.lockedUntil && f.lockedUntil > Date.now()) {
    const minutes = Math.ceil((f.lockedUntil - Date.now()) / 60_000);
    throw new HttpException(`Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an admin to reset it.`, 429);
  }
}

function recordFailure(phone: string) {
  const now = Date.now();
  const f = failures.get(phone);
  const entry = !f || now - f.first > WINDOW_MS || (f.lockedUntil && f.lockedUntil <= now) ? { count: 0, first: now } : f;
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) entry.lockedUntil = now + WINDOW_MS;
  failures.set(phone, entry);
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    const phone = normalizePhone(body.phone);
    checkLock(phone);
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
      recordFailure(phone);
      throw new UnauthorizedException('Wrong phone number or password');
    }
    failures.delete(phone);

    const payload: AuthUser = { sub: user.id, tenantId: user.tenantId, role: user.role, name: user.fullName };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: user.id, fullName: user.fullName, role: user.role },
      facility: user.tenant,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /** Any signed-in user changes their own password (and so replaces a temporary one). */
  @Post('password')
  @HttpCode(200)
  @AllowPendingPassword()
  async changePassword(@CurrentUser() me: AuthUser, @Body(new ZodPipe(PasswordSchema)) body: z.infer<typeof PasswordSchema>) {
    const user = await this.prisma.client.user.findFirst({ where: { id: me.sub, tenantId: me.tenantId } });
    if (!user || !(await bcrypt.compare(body.current, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is not correct');
    }
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.next, 10), mustChangePassword: false },
    });
    forgetAccount(user.id);
    await this.audit.log(me, 'user.password', 'User', user.id);
    return { ok: true };
  }

  @Get('me')
  @AllowPendingPassword()
  async me(@CurrentUser() me: AuthUser) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: me.sub, tenantId: me.tenantId, active: true },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        mustChangePassword: true,
        // The screens use this to show or hide "Register patient" for doctors.
        tenant: { select: { id: true, name: true, nameAm: true, doctorsCanRegister: true } },
      },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

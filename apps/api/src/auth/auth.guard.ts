import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@hmis/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { ALLOW_PENDING_PASSWORD, ALLOW_TWO_STEP_SETUP, type AuthUser, IS_PUBLIC, ROLES } from './auth.decorators.js';

type Account = { active: boolean; role: Role; tenantId: string; mustChangePassword: boolean; sessionsValidAfter: Date | null; totpEnabledAt: Date | null };

/**
 * A token proves who signed in, not that they still may work here. Each request re-reads the
 * account (cached for a few seconds), so deactivating someone or changing their role takes effect
 * within ACCOUNT_TTL_MS instead of when their 12-hour token runs out.
 */
const ACCOUNT_TTL_MS = 15_000;
const accounts = new Map<string, { at: number; account: Account | null }>();

/** Call after changing a user's account so the next request sees it immediately. */
export function forgetAccount(userId: string) {
  accounts.delete(userId);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  private async account(userId: string): Promise<Account | null> {
    const hit = accounts.get(userId);
    if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.account;
    // Before the request's clinic is set, so the owner connection (a primary-key lookup).
    const account = await this.prisma.system.user.findUnique({
      where: { id: userId },
      select: { active: true, role: true, tenantId: true, mustChangePassword: true, sessionsValidAfter: true, totpEnabledAt: true },
    });
    accounts.set(userId, { at: Date.now(), account });
    return account;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();

    let claims: AuthUser & { iat?: number; purpose?: string };
    try {
      claims = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException();
    }

    // A two-step challenge (password checked, code not yet) is never a session.
    if (claims.purpose) throw new UnauthorizedException();

    const account = await this.account(claims.sub);
    if (!account || !account.active || account.tenantId !== claims.tenantId) {
      throw new UnauthorizedException('Your account is no longer active');
    }
    // Signed in before the password was changed or reset: that sign-in no longer counts.
    // (Compared in whole seconds, the precision of the token's issue time.)
    if (account.sessionsValidAfter && (claims.iat ?? 0) < Math.floor(account.sessionsValidAfter.getTime() / 1000)) {
      throw new UnauthorizedException('Please sign in again');
    }
    const { iat: _iat, purpose: _purpose, ...rest } = claims;
    const user: AuthUser = { ...rest, role: account.role }; // the current role, not the one at sign-in
    req.user = user;

    if (account.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException({ message: 'Choose a new password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    // Admins can change prices, refund money and manage staff: they must use two-step sign-in.
    if (account.role === 'ADMIN' && !account.totpEnabledAt && !this.reflector.getAllAndOverride<boolean>(ALLOW_TWO_STEP_SETUP, targets)) {
      throw new ForbiddenException({ message: 'Set up two-step sign-in before continuing', code: 'TWO_STEP_SETUP_REQUIRED' });
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role does not allow this action');
    }
    return true;
  }
}

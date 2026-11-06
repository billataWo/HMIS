import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@hmis/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { ALLOW_PENDING_PASSWORD, type AuthUser, IS_PUBLIC, ROLES } from './auth.decorators.js';

type Account = { active: boolean; role: Role; tenantId: string; mustChangePassword: boolean };

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
      select: { active: true, role: true, tenantId: true, mustChangePassword: true },
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

    let claims: AuthUser;
    try {
      claims = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException();
    }

    const account = await this.account(claims.sub);
    if (!account || !account.active || account.tenantId !== claims.tenantId) {
      throw new UnauthorizedException('Your account is no longer active');
    }
    const user: AuthUser = { ...claims, role: account.role }; // the current role, not the one at sign-in
    req.user = user;

    if (account.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException({ message: 'Choose a new password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role does not allow this action');
    }
    return true;
  }
}

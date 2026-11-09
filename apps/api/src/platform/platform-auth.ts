import { createHmac } from 'node:crypto';
import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PlatformRole } from '@hmis/db';
import { PrismaService } from '../prisma/prisma.service.js';

/** The platform console and the request page exist only on the HMIS cloud (HMIS_PLATFORM=1). */
export const platformEnabled = () => process.env.HMIS_PLATFORM === '1';

/**
 * Operators' sessions are signed with their own key, derived from JWT_SECRET: a clinic sign-in can
 * never pass for an operator's, or the other way round (AuthGuard also refuses `kind`).
 */
export function platformSecret() {
  return createHmac('sha256', process.env.JWT_SECRET ?? '').update('hmis-platform-sessions').digest('base64url');
}

export interface Operator {
  sub: string;
  role: PlatformRole;
  name: string;
}

const ROLES = 'platformRoles';
const ALLOW_PENDING = 'platformAllowPending';
/** Restrict to these operator roles (OWNER can always). */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(ROLES, roles);
/** Reachable before the operator has replaced the temporary password and set up two-step sign-in. */
export const PlatformAllowPending = () => SetMetadata(ALLOW_PENDING, true);

export const CurrentOperator = createParamDecorator((_: unknown, ctx: ExecutionContext): Operator => ctx.switchToHttp().getRequest().operator);

type Account = { active: boolean; role: PlatformRole; fullName: string; mustChangePassword: boolean; sessionsValidAfter: Date | null; totpEnabledAt: Date | null };
const TTL_MS = 15_000;
const accounts = new Map<string, { at: number; account: Account | null }>();
export function forgetOperator(id: string) {
  accounts.delete(id);
}

/**
 * For the platform console's endpoints (which are @Public() for the clinic AuthGuard). Every
 * operator must have changed the temporary password and set up two-step sign-in: they can see
 * every clinic's subscription and create clinics.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  private async account(id: string) {
    const hit = accounts.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.account;
    const account = await this.prisma.system.platformUser.findUnique({
      where: { id },
      select: { active: true, role: true, fullName: true, mustChangePassword: true, sessionsValidAfter: true, totpEnabledAt: true },
    });
    accounts.set(id, { at: Date.now(), account });
    return account;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!platformEnabled()) throw new NotFoundException();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();
    let claims: { sub: string; kind?: string; purpose?: string; iat?: number };
    try {
      claims = await this.jwt.verifyAsync(token, { secret: platformSecret() });
    } catch {
      throw new UnauthorizedException();
    }
    if (claims.kind !== 'platform' || claims.purpose) throw new UnauthorizedException();
    const account = await this.account(claims.sub);
    if (!account?.active) throw new UnauthorizedException('Your account is no longer active');
    if (account.sessionsValidAfter && (claims.iat ?? 0) < Math.floor(account.sessionsValidAfter.getTime() / 1000)) {
      throw new UnauthorizedException('Please sign in again');
    }
    req.operator = { sub: claims.sub, role: account.role, name: account.fullName } satisfies Operator;

    if (!this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, targets)) {
      if (account.mustChangePassword) throw new ForbiddenException({ message: 'Choose a new password first', code: 'PASSWORD_CHANGE_REQUIRED' });
      if (!account.totpEnabledAt) throw new ForbiddenException({ message: 'Set up two-step sign-in first', code: 'TWO_STEP_SETUP_REQUIRED' });
    }
    const roles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(ROLES, targets);
    if (roles && account.role !== 'OWNER' && !roles.includes(account.role)) throw new ForbiddenException('Your role does not allow this');
    return true;
  }
}

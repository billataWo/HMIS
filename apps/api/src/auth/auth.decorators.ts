import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@hmis/db';

export interface AuthUser {
  sub: string;
  tenantId: string;
  role: Role;
  name: string;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';

/** Reachable by an admin who has not set up two-step sign-in yet (who am I, the setup itself). */
export const ALLOW_TWO_STEP_SETUP = 'allowTwoStepSetup';
export const AllowTwoStepSetup = () => SetMetadata(ALLOW_TWO_STEP_SETUP, true);

/** Reachable while the user still has to replace a temporary password (who am I, change password). */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** Skip authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route to the given roles. A route without @Roles, @AllStaff or @Public is refused. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const ALL_ROLES: Role[] = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'CASHIER', 'PHARMACIST', 'LAB_TECH'];

/**
 * Open to every signed-in member of the clinic's staff (their own account, the queue, look-ups).
 * Said explicitly, so a route that forgot its roles is refused instead of open to everyone.
 */
export const AllStaff = () => SetMetadata(ROLES, ALL_ROLES);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

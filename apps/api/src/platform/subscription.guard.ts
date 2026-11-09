import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthUser, IS_PUBLIC } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  licenceRequired,
  licenceState,
  readLicence,
} from '../licence/licence.js';
import { platformEnabled } from './platform-auth.js';
import {
  type Feature,
  FEATURES,
  type StateInfo,
  subscriptionState,
} from './subscription-state.js';

export interface TenantPlan extends StateInfo {
  /** False: no subscription (development, a server from before subscriptions): no limits. */
  managed: boolean;
  planName: string | null;
  /** null: every module. */
  features: string[] | null;
  /** null: no limit. */
  maxStaff: number | null;
  /** Where it comes from: the cloud's subscription, or the HMIS licence installed on this server. */
  source: 'subscription' | 'licence' | 'none';
  /** A server that needs an HMIS licence has none (or not a valid one): read-only. */
  unlicensed?: boolean;
}

const UNMANAGED: TenantPlan = {
  managed: false,
  state: 'active',
  readOnly: false,
  manual: false,
  endsAt: null,
  graceEndsAt: null,
  daysLeft: null,
  planName: null,
  features: null,
  maxStaff: null,
  source: 'none',
};

const UNLICENSED: TenantPlan = {
  ...UNMANAGED,
  managed: true,
  state: 'suspended',
  readOnly: true,
  manual: true,
  unlicensed: true,
  source: 'licence',
};

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; plan: TenantPlan }>();

/** Call after changing a clinic's subscription, so its next request sees it. */
export function forgetSubscription(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** The clinic's plan and where its subscription stands (cached for a few seconds). */
export async function tenantPlan(
  prisma: PrismaService,
  tenantId: string,
): Promise<TenantPlan> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;
  const plan = await lookup(prisma, tenantId);
  cache.set(tenantId, { at: Date.now(), plan });
  return plan;
}

/**
 * On the HMIS cloud, the clinic's subscription. Elsewhere (a clinic server, an own-server install),
 * the HMIS licence installed here comes first; then a subscription row (development, or a server
 * from before licences); with HMIS_LICENCE=required and no valid licence, read-only.
 */
async function lookup(
  prisma: PrismaService,
  tenantId: string,
): Promise<TenantPlan> {
  const fromSubscription = async (): Promise<TenantPlan | null> => {
    const sub = await prisma.system.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    return sub
      ? {
          managed: true,
          ...subscriptionState(sub),
          planName: sub.plan.name,
          features: sub.plan.features,
          maxStaff: sub.plan.maxStaff,
          source: 'subscription',
        }
      : null;
  };
  if (platformEnabled()) return (await fromSubscription()) ?? UNMANAGED;
  const installed = await prisma.system.installedLicence.findUnique({
    where: { tenantId },
  });
  if (installed) {
    const read = readLicence(installed.licence);
    if (read.ok && read.licence.tenantId === tenantId) {
      const l = read.licence;
      return {
        managed: true,
        ...licenceState(l),
        planName: l.plan.name,
        features: l.plan.features,
        maxStaff: l.plan.maxStaff,
        source: 'licence',
      };
    }
  }
  if (licenceRequired()) return UNLICENSED;
  return (await fromSubscription()) ?? UNMANAGED;
}

const ALLOW_WHILE_SUSPENDED = 'allowWhileSuspended';
/** Works while the clinic is read-only: signing in, changing a password, paying the bill. */
export const AllowWhileSuspended = () =>
  SetMetadata(ALLOW_WHILE_SUSPENDED, true);

const REQUIRES_FEATURE = 'requiresFeature';
/** Changes here need this module in the clinic's plan (looking at existing records does not). */
export const RequiresFeature = (feature: Feature) =>
  SetMetadata(REQUIRES_FEATURE, feature);

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Applies the clinic's subscription to every request (after AuthGuard): a suspended or cancelled
 * clinic is read-only, and a module missing from the plan cannot be changed.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest();
    if (READS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;
    const user: AuthUser | undefined = req.user;
    if (!user) return true;
    const plan = await tenantPlan(this.prisma, user.tenantId);
    if (!plan.managed) return true;

    if (
      plan.readOnly &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_SUSPENDED, targets)
    ) {
      throw new HttpException(
        {
          message: plan.unlicensed
            ? 'This server has no valid HMIS licence: records can be looked at but not changed. Install the licence in Settings → Subscription.'
            : plan.state === 'cancelled'
              ? "This clinic's HMIS subscription has ended: records can be looked at but not changed."
              : "This clinic's HMIS subscription is suspended: records can be looked at but not changed until the bill is paid (Settings → Subscription).",
          code: 'SUBSCRIPTION_SUSPENDED',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const feature = this.reflector.getAllAndOverride<Feature | undefined>(
      REQUIRES_FEATURE,
      targets,
    );
    if (feature && plan.features && !plan.features.includes(feature)) {
      throw new ForbiddenException({
        message: `${FEATURES[feature]} is not in this clinic's plan (${plan.planName}).`,
        code: 'FEATURE_NOT_IN_PLAN',
      });
    }
    return true;
  }
}

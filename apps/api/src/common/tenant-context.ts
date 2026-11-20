import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.decorators.js';
import { clientIp } from './client-ip.js';

/**
 * The clinic the current request acts for (read by the database pool to apply row-level security),
 * and where the request came from (its address and browser, recorded in the audit log).
 */
export const tenantContext = new AsyncLocalStorage<{ tenantId?: string; ip?: string | null; userAgent?: string | null }>();

/** The request's address and browser, for an audit entry (empty outside a request). */
export function requestOrigin() {
  const s = tenantContext.getStore();
  return { ip: s?.ip ?? null, userAgent: s?.userAgent ?? null };
}

/** The browser line, trimmed to a sensible length. */
export const userAgentOf = (req: Request) => (typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null);

/**
 * Runs each request handler inside the signed-in user's tenant context. Interceptors run after
 * guards, so req.user (set by AuthGuard) is available; the handler is subscribed inside run() so
 * every database call it makes sees the tenant.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req: Request & { user?: AuthUser } = ctx.switchToHttp().getRequest();
    const user = req.user;
    const origin = req.socket ? { ip: clientIp(req), userAgent: userAgentOf(req) } : {};
    return new Observable((subscriber) =>
      tenantContext.run({ tenantId: user?.tenantId, ...origin }, () => {
        const sub = next.handle().subscribe(subscriber);
        return () => sub.unsubscribe();
      }),
    );
  }
}

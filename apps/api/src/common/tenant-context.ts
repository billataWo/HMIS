import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.decorators.js';

/** The clinic the current request acts for; read by the database pool to apply row-level security. */
export const tenantContext = new AsyncLocalStorage<{ tenantId?: string }>();

/**
 * Runs each request handler inside the signed-in user's tenant context. Interceptors run after
 * guards, so req.user (set by AuthGuard) is available; the handler is subscribed inside run() so
 * every database call it makes sees the tenant.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    return new Observable((subscriber) =>
      tenantContext.run({ tenantId: user?.tenantId }, () => {
        const sub = next.handle().subscribe(subscriber);
        return () => sub.unsubscribe();
      }),
    );
  }
}

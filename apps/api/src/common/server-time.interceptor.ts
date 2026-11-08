import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Stamps each successful reply with X-Server-Time: the moment the API finished handling it, to
 * the millisecond, by the server's clock. The browser's offline mode compares these times (when
 * a piece of queued work was applied, when a snapshot was read) instead of the PC's own clock,
 * which in clinics is often wrong. A replayed reply keeps the time its original request set.
 */
@Injectable()
export class ServerTimeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse();
    return next.handle().pipe(
      tap(() => {
        if (!res.headersSent && !res.getHeader('X-Server-Time')) res.setHeader('X-Server-Time', new Date().toISOString());
      }),
    );
  }
}

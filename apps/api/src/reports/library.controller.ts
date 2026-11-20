import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { DAY_PATTERN, isDay } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REPORT_KEYS, runReport } from './library.js';

const QuerySchema = z.object({
  from: z.string().regex(DAY_PATTERN),
  to: z.string().regex(DAY_PATTERN),
  method: z.enum(['CASH', 'TELEBIRR', 'CHAPA', 'BANK_TRANSFER']).optional(),
  doctorId: z.string().uuid().optional(),
  status: z.string().regex(/^[A-Z_]{2,30}$/).optional(),
  days: z.coerce.number().int().min(0).max(730).optional(),
});
type Query = z.infer<typeof QuerySchema>;

/** The report library (reports/library.ts): one named report's rows, to view or to export. Admins only. */
@Controller('reports/library')
@Roles('ADMIN')
export class ReportLibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private check(key: string, q: Query) {
    if (!REPORT_KEYS.includes(key)) throw new NotFoundException('No such report');
    if (!isDay(q.from) || !isDay(q.to)) throw new BadRequestException('Choose real dates');
    if (q.from > q.to) throw new BadRequestException('"from" must be on or before "to"');
    if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 366) throw new BadRequestException('Choose a range of at most one year');
  }

  @Get(':key')
  run(@CurrentUser() me: AuthUser, @Param('key') key: string, @Query(new ZodPipe(QuerySchema)) q: Query) {
    this.check(key, q);
    return runReport(key, { db: this.prisma.client, t: me.tenantId, me, q });
  }

  /** The same rows for a file: recorded in the audit log, since most reports name patients. */
  @Get(':key/export')
  async export(@CurrentUser() me: AuthUser, @Param('key') key: string, @Query(new ZodPipe(QuerySchema)) q: Query) {
    this.check(key, q);
    const result = await runReport(key, { db: this.prisma.client, t: me.tenantId, me, q });
    await this.audit.log(me, 'report.exported', 'Report', key, { ...q, rows: result.rows.length });
    return result;
  }
}

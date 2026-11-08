import { Controller, Get } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { ICD11_COMMON } from '../consultation/icd11-common.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PRESCRIBERS = new Set(['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST']);

/**
 * Reference lists the browser keeps for working offline (the offline workspace in the web app):
 * the common ICD-11 diagnoses and, for prescribers, every active drug with its usable stock.
 * Today's work itself (queue, worklists, bills) comes from the usual endpoints.
 */
@Controller('offline')
export class OfflineController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('reference')
  async reference(@CurrentUser() me: AuthUser) {
    if (!PRESCRIBERS.has(me.role)) return { icd: ICD11_COMMON, drugs: [] };
    const db = this.prisma.client;
    const [drugs, stock] = await Promise.all([
      db.drug.findMany({
        where: { tenantId: me.tenantId, active: true },
        select: { id: true, genericName: true, brandName: true, strength: true, form: true, unit: true, sellPrice: true },
        orderBy: { genericName: 'asc' },
        take: 2000,
      }),
      db.stockBatch.groupBy({
        by: ['drugId'],
        where: { drug: { tenantId: me.tenantId }, quantity: { gt: 0 }, expiryDate: { gte: dayRange(clinicDay()).start } },
        _sum: { quantity: true },
      }),
    ]);
    const inStock = new Map(stock.map((s) => [s.drugId, s._sum.quantity ?? 0]));
    return { icd: ICD11_COMMON, drugs: drugs.map((d) => ({ ...d, inStock: inStock.get(d.id) ?? 0 })) };
  }
}

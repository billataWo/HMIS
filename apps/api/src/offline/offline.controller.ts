import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { type AuthUser, CurrentUser, AllStaff, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { ICD11_COMMON } from '../consultation/icd11-common.js';
import { WALK_IN_MRN } from '../patients/patients.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { queuePatientSelect } from '../visits/visits.controller.js';

const PRESCRIBERS = new Set(['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST']);
/** How many patients the front desk keeps for finding returning patients offline (newest first). */
export const OFFLINE_PATIENTS = 10_000;

/**
 * Reference lists the browser keeps for working offline (the offline workspace in the web app):
 * the common ICD-11 diagnoses and, for prescribers, every active drug with its usable stock.
 * Today's work itself (queue, worklists, bills) comes from the usual endpoints.
 */
@Controller('offline')
export class OfflineController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Turned off in Settings: browsers keep no patient data, so the offline downloads are refused. */
  private async assertOn(me: AuthUser) {
    const { offlineMode } = await this.prisma.client.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { offlineMode: true } });
    if (!offlineMode) throw new ForbiddenException({ message: 'Offline mode is turned off for this clinic', code: 'OFFLINE_MODE_OFF' });
  }

  @AllStaff()
  @Get('reference')
  async reference(@CurrentUser() me: AuthUser) {
    await this.assertOn(me);
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

  /**
   * The clinic's patients for the front desk to find returning patients with no connection (the
   * same details the queue shows), newest first. Downloaded every few hours, not with each
   * snapshot; the snapshot's recent registrations fill the gap in between. The card numbers of
   * records merged into a patient are included, since that is the number on the patient's card.
   */
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE')
  @Get('patients')
  async patients(@CurrentUser() me: AuthUser) {
    await this.assertOn(me);
    const patients = await this.prisma.client.patient.findMany({
      where: { tenantId: me.tenantId, mergedIntoId: null, mrn: { not: WALK_IN_MRN } },
      select: { ...queuePatientSelect, mergedFrom: { select: { mrn: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: OFFLINE_PATIENTS,
    });
    // The clinic's patient list leaves the server for a PC: recorded (every 6 hours per PC).
    await this.audit.log(me, 'offline.patients_copied', 'Tenant', me.tenantId, { patients: patients.length });
    return patients.map(({ mergedFrom, ...p }) => ({ ...p, ...(mergedFrom.length && { oldMrns: mergedFrom.map((m) => m.mrn) }) }));
  }
}

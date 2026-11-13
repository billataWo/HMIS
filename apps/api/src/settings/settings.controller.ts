import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles, AllStaff } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ensureStores } from '../inventory/stores.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SettingsSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  nameAm: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  requirePrepayment: z.boolean().optional(),
  doctorsCanRegister: z.boolean().optional(),
  // A main store and a dispensary (or more), with transfers between them.
  multiStore: z.boolean().optional(),
  // How fast an urgent lab test should be released, sample to result (minutes).
  labUrgentMinutes: z.number().int().min(10).max(24 * 60).optional(),
});

const select = { id: true, name: true, nameAm: true, phone: true, address: true, type: true, requirePrepayment: true, doctorsCanRegister: true, multiStore: true, labUrgentMinutes: true };

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @AllStaff()
  @Get()
  get(@CurrentUser() me: AuthUser) {
    return this.prisma.client.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select });
  }

  @Patch()
  @Roles('ADMIN')
  async update(@CurrentUser() me: AuthUser, @Body(new ZodPipe(SettingsSchema)) body: z.infer<typeof SettingsSchema>) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      // Turning several stores on sets up a Main store and a Dispensary and puts current stock in
      // the dispensary; turning it off keeps the stores (stock is simply all usable again).
      if (body.multiStore) await ensureStores(tx, me.tenantId);
      return tx.tenant.update({ where: { id: me.tenantId }, data: body, select });
    });
    await this.audit.log(me, 'settings.update', 'Tenant', me.tenantId, body);
    return updated;
  }
}

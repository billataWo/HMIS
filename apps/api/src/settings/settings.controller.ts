import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SettingsSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  nameAm: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  requirePrepayment: z.boolean().optional(),
});

const select = { id: true, name: true, nameAm: true, phone: true, address: true, type: true, requirePrepayment: true };

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@CurrentUser() me: AuthUser) {
    return this.prisma.client.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select });
  }

  @Patch()
  @Roles('ADMIN')
  async update(@CurrentUser() me: AuthUser, @Body(new ZodPipe(SettingsSchema)) body: z.infer<typeof SettingsSchema>) {
    const updated = await this.prisma.client.tenant.update({ where: { id: me.tenantId }, data: body, select });
    await this.audit.log(me, 'settings.update', 'Tenant', me.tenantId, body);
    return updated;
  }
}

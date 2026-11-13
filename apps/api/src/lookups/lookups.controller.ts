import { Controller, Get } from '@nestjs/common';
import { type AuthUser, CurrentUser, AllStaff } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Small read-only lists that any signed-in user needs for dropdowns. */
@Controller('lookups')
export class LookupsController {
  constructor(private readonly prisma: PrismaService) {}

  @AllStaff()
  @Get('doctors')
  doctors(@CurrentUser() me: AuthUser) {
    return this.prisma.client.user.findMany({
      where: { tenantId: me.tenantId, role: 'DOCTOR', active: true },
      select: { id: true, fullName: true, room: true },
      orderBy: { fullName: 'asc' },
    });
  }

  @AllStaff()
  @Get('services')
  services(@CurrentUser() me: AuthUser) {
    return this.prisma.client.serviceItem.findMany({
      where: { tenantId: me.tenantId, active: true },
      select: { id: true, code: true, name: true, price: true, kind: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  /** Credit companies and insurers in use: for recording a patient's coverage (no balances). */
  @AllStaff()
  @Get('payers')
  payers(@CurrentUser() me: AuthUser) {
    return this.prisma.client.payer.findMany({
      where: { tenantId: me.tenantId, active: true },
      select: { id: true, name: true, type: true, coPayPercent: true, requiresAuthorization: true },
      orderBy: { name: 'asc' },
    });
  }
}

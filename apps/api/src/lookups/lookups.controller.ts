import { Controller, Get } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Small read-only lists that any signed-in user needs for dropdowns. */
@Controller('lookups')
export class LookupsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('doctors')
  doctors(@CurrentUser() me: AuthUser) {
    return this.prisma.client.user.findMany({
      where: { tenantId: me.tenantId, role: 'DOCTOR', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  @Get('services')
  services(@CurrentUser() me: AuthUser) {
    return this.prisma.client.serviceItem.findMany({
      where: { tenantId: me.tenantId, active: true },
      select: { id: true, code: true, name: true, price: true },
      orderBy: { name: 'asc' },
    });
  }
}

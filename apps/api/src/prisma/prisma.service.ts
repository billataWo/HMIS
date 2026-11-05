import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type Db } from '@hmis/db';
import { tenantContext } from '../common/tenant-context.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  /**
   * For request handling: connects as the restricted hmis_app role, so PostgreSQL row-level
   * security limits every query to the signed-in user's clinic.
   */
  readonly client: Db;
  /**
   * Unrestricted owner connection. Only for lookups that must span clinics before a tenant is
   * known (sign-in by phone number). Never use it for data a user asked for.
   */
  readonly system: Db;

  constructor() {
    const appUrl = process.env.APP_DATABASE_URL;
    if (!appUrl) {
      new Logger('Prisma').warn('APP_DATABASE_URL is not set: running without row-level security (owner connection).');
    }
    this.client = createPrismaClient(appUrl ?? process.env.DATABASE_URL, { tenant: () => tenantContext.getStore()?.tenantId });
    this.system = createPrismaClient(process.env.DATABASE_URL);
  }

  async onModuleDestroy() {
    await Promise.all([this.client.$disconnect(), this.system.$disconnect()]);
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

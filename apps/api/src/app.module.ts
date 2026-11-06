import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextInterceptor } from './common/tenant-context.js';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuditService } from './common/audit.service.js';
import { PatientsController } from './patients/patients.controller.js';
import { PrismaModule } from './prisma/prisma.service.js';
import { UsersController } from './users/users.controller.js';
import { VisitsController } from './visits/visits.controller.js';
import { AppointmentsController } from './appointments/appointments.controller.js';
import { LookupsController } from './lookups/lookups.controller.js';
import { ConsultationController } from './consultation/consultation.controller.js';
import { PrescriptionsController } from './prescriptions/prescriptions.controller.js';
import { PharmacyController } from './pharmacy/pharmacy.controller.js';
import { BillingController } from './billing/billing.controller.js';
import { LabController } from './lab/lab.controller.js';
import { SettingsController } from './settings/settings.controller.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { ReportsController } from './reports/reports.controller.js';
import { ProceduresController } from './procedures/procedures.controller.js';
import { AuditController } from './audit/audit.controller.js';
import { BackupsController } from './backups/backups.controller.js';
import { DocumentsController } from './documents/documents.controller.js';
import { WalkInController } from './pharmacy/walk-in.controller.js';
import { PayersController } from './payers/payers.controller.js';
import { PurchaseOrdersController } from './inventory/purchase-orders.controller.js';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || (process.env.NODE_ENV === 'production' && jwtSecret === 'change-me')) {
  throw new Error('Set a strong JWT_SECRET in the environment');
}

@Module({
  imports: [PrismaModule, JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '12h' } })],
  controllers: [
    AppController,
    AuthController,
    UsersController,
    PatientsController,
    VisitsController,
    AppointmentsController,
    LookupsController,
    ConsultationController,
    PrescriptionsController,
    PharmacyController,
    BillingController,
    LabController,
    SettingsController,
    InventoryController,
    CatalogController,
    ReportsController,
    ProceduresController,
    AuditController,
    BackupsController,
    DocumentsController,
    WalkInController,
    PayersController,
    PurchaseOrdersController,
  ],
  providers: [
    AuditService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}

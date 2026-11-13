import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextInterceptor } from './common/tenant-context.js';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { TwoStepController } from './auth/two-step.controller.js';
import { DisplaysController } from './displays/displays.controller.js';
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
import { LabQcController } from './lab/lab-qc.controller.js';
import { CoverageController } from './billing/coverage.controller.js';
import { SettingsController } from './settings/settings.controller.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { ReportsController } from './reports/reports.controller.js';
import { ProceduresController } from './procedures/procedures.controller.js';
import { AuditController } from './audit/audit.controller.js';
import { BackupsController } from './backups/backups.controller.js';
import { CloudCopyGuard } from './sync/read-only.guard.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { ServerTimeInterceptor } from './common/server-time.interceptor.js';
import { OfflineController } from './offline/offline.controller.js';
import { SyncAgent } from './sync/sync.agent.js';
import { SyncController } from './sync/sync.controller.js';
import { DocumentsController } from './documents/documents.controller.js';
import { WalkInController } from './pharmacy/walk-in.controller.js';
import { PayersController } from './payers/payers.controller.js';
import { PurchaseOrdersController } from './inventory/purchase-orders.controller.js';
import { ControlledRegisterController } from './inventory/controlled.controller.js';
import { StoresController } from './inventory/stores.controller.js';
import { PlatformAuthController } from './platform/platform-auth.controller.js';
import { PlatformController } from './platform/platform.controller.js';
import { PlatformVoiceController } from './platform/voice.controller.js';
import { PublicController } from './platform/public.controller.js';
import { SubscriptionController } from './platform/subscription.controller.js';
import { PlatformGuard } from './platform/platform-auth.js';
import { SubscriptionGuard } from './platform/subscription.guard.js';
import { PaymentsController } from './platform/payments/payments.controller.js';
import { SubscriptionScheduler } from './platform/payments/scheduler.js';
import { LicenceAgent } from './licence/licence.agent.js';
import { ExportsController } from './exports/exports.controller.js';

const jwtSecret = process.env.JWT_SECRET;
// Anyone who knows this secret can sign in as anyone, in any clinic: in production it must be
// long and random (openssl rand -base64 48), never a placeholder.
const WEAK_SECRETS = new Set(['change-me', 'changeme', 'secret', 'jwt-secret', 'password']);
if (!jwtSecret) throw new Error('Set JWT_SECRET in the environment');
if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 32 || WEAK_SECRETS.has(jwtSecret.toLowerCase()))) {
  throw new Error('JWT_SECRET is too weak for production: use at least 32 random characters (openssl rand -base64 48)');
}

@Module({
  imports: [PrismaModule, JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '12h', algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } })],
  controllers: [
    AppController,
    AuthController,
    TwoStepController,
    DisplaysController,
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
    LabQcController,
    CoverageController,
    SettingsController,
    InventoryController,
    CatalogController,
    ReportsController,
    ProceduresController,
    AuditController,
    BackupsController,
    SyncController,
    OfflineController,
    DocumentsController,
    WalkInController,
    PayersController,
    PurchaseOrdersController,
    ControlledRegisterController,
    StoresController,
    SubscriptionController,
    PublicController,
    PlatformAuthController,
    PlatformController,
    PlatformVoiceController,
    PaymentsController,
    ExportsController,
  ],
  providers: [
    AuditService,
    { provide: APP_GUARD, useClass: AuthGuard },
    // After AuthGuard (needs the signed-in user): cloud copies of clinic-server clinics are read-only.
    { provide: APP_GUARD, useClass: CloudCopyGuard },
    // Then the clinic's subscription: read-only when suspended, modules outside the plan.
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    PlatformGuard,
    SubscriptionScheduler,
    LicenceAgent,
    SyncAgent,
    // Outermost: stamps every reply with the server time (see the interceptor).
    { provide: APP_INTERCEPTOR, useClass: ServerTimeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    // Inside the tenant context (registered after it): replayed offline work is applied once.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}

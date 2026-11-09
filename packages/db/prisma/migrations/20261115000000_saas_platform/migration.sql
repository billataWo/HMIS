-- CreateEnum
CREATE TYPE "DeploymentType" AS ENUM ('CLOUD', 'CLINIC_SERVER', 'ON_PREMISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ClinicRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('OWNER', 'BILLING', 'SUPPORT');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PlatformPaymentMethod" AS ENUM ('CHAPA', 'TELEBIRR', 'BANK_TRANSFER', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" DECIMAL(12,2) NOT NULL,
    "priceYearly" DECIMAL(12,2) NOT NULL,
    "maxStaff" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "deployment" "DeploymentType" NOT NULL DEFAULT 'CLOUD',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "trialEndsAt" TIMESTAMP(3),
    "paidUntil" TIMESTAMP(3),
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "clinicNameAm" TEXT,
    "type" "FacilityType" NOT NULL DEFAULT 'CLINIC',
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "licenceNumber" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "planCode" TEXT,
    "staffCount" INTEGER,
    "deployment" "DeploymentType" NOT NULL DEFAULT 'CLOUD',
    "message" TEXT,
    "status" "ClinicRequestStatus" NOT NULL DEFAULT 'PENDING',
    "ip" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'SUPPORT',
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "sessionsValidAfter" TIMESTAMP(3),
    "totpSecret" TEXT,
    "totpPendingSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "totpRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSignInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "tenantId" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER NOT NULL DEFAULT 30,
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "vatPercent" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "bankDetails" TEXT,
    "supportPhone" TEXT,
    "supportEmail" TEXT,
    "nextInvoice" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "vat" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PlatformPaymentMethod" NOT NULL,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reportedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "provider" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicRequest_reference_key" ON "ClinicRequest"("reference");

-- CreateIndex
CREATE INDEX "ClinicRequest_status_createdAt_idx" ON "ClinicRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_tenantId_createdAt_idx" ON "PlatformAuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_number_key" ON "PlatformInvoice"("number");

-- CreateIndex
CREATE INDEX "PlatformInvoice_tenantId_issuedAt_idx" ON "PlatformInvoice"("tenantId", "issuedAt");

-- CreateIndex
CREATE INDEX "PlatformInvoice_status_dueDate_idx" ON "PlatformInvoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PlatformPayment_tenantId_createdAt_idx" ON "PlatformPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformPayment_status_idx" ON "PlatformPayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_method_reference_key" ON "PlatformPayment"("method", "reference");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Who may see what ──────────────────────────────────────────────────────────────────────────
-- The platform is run through the owner connection (the platform console, the request page). The
-- application role reads a clinic's own subscription and invoices (to show them and to enforce the
-- plan), and the plans; it never writes any of it, and never sees requests, operators or settings.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'hmis_app') THEN
    REVOKE ALL ON "Plan", "Subscription", "ClinicRequest", "PlatformUser", "PlatformAuditLog",
                  "PlatformSetting", "PlatformInvoice", "PlatformPayment" FROM hmis_app;
    GRANT SELECT ON "Plan", "Subscription", "PlatformInvoice", "PlatformPayment" TO hmis_app;
  END IF;
END
$$;

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subscription"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "PlatformInvoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlatformInvoice"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "PlatformPayment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlatformPayment"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- None of this is sent between clinic servers and the cloud: subscriptions are the cloud's
-- (listed in NOT_SYNCED in apps/api/src/sync/engine.ts, no capture trigger).

-- ─── Starting point ────────────────────────────────────────────────────────────────────────────
-- Suggested plans: HMIS sets the real names, prices, limits and modules in the platform console.
INSERT INTO "Plan" ("id", "code", "name", "description", "priceMonthly", "priceYearly", "maxStaff", "features", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'BASIC', 'Basic', 'A small clinic: registration, consultation, lab, pharmacy and billing.', 2500, 25000, 5, '{}', 1, now()),
  (gen_random_uuid(), 'STANDARD', 'Standard', 'A clinic with more staff, credit companies and insurance, and purchase orders.', 5000, 50000, 15, '{CREDIT,PURCHASE_ORDERS}', 2, now()),
  (gen_random_uuid(), 'HOSPITAL', 'Hospital', 'A hospital or large clinic: no staff limit, every module, its own clinic server.', 12000, 120000, NULL, '{CREDIT,PURCHASE_ORDERS,CLINIC_SERVER}', 3, now());

INSERT INTO "PlatformSetting" ("id", "updatedAt") VALUES (1, now());

-- Clinics that already use HMIS keep working exactly as before: every module, no staff limit and
-- no end date, until HMIS gives them a plan in the platform console.
INSERT INTO "Subscription" ("id", "tenantId", "planId", "status", "notes", "updatedAt")
SELECT gen_random_uuid(), t."id", (SELECT "id" FROM "Plan" WHERE "code" = 'HOSPITAL'), 'ACTIVE',
       'Using HMIS before subscriptions existed: no end date until a plan is agreed.', now()
  FROM "Tenant" t
 WHERE t."name" <> '(waiting for the clinic server)';

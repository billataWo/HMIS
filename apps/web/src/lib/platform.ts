import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, ApiError } from "./api";
import type { SubscriptionState } from "./api";

/** HMIS staff's sign-in to the platform console (never a clinic sign-in). */
export const PLATFORM_COOKIE = "hmis_platform";
export const PLATFORM_CHALLENGE_COOKIE = "hmis_platform_challenge";

/** Calls the platform API as the signed-in operator. */
export async function platformApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) redirect("/platform/login");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
    });
  } catch (cause) {
    throw new Error(`Can't reach the HMIS server at ${API_URL}.`, { cause });
  }
  // The session has ended (expired, password changed elsewhere): the cookie goes too.
  if (res.status === 401) redirect("/platform/signout");
  if (res.status === 404 && path.startsWith("/platform/auth/me")) redirect("/platform/signout");
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (res.status === 403 && (body?.code === "PASSWORD_CHANGE_REQUIRED" || body?.code === "TWO_STEP_SETUP_REQUIRED")) redirect("/platform/account");
  if (!res.ok) throw new ApiError(res.status, body ?? {});
  return body as T;
}

export type PlatformRole = "OWNER" | "BILLING" | "SUPPORT";
export type Deployment = "CLOUD" | "CLINIC_SERVER" | "ON_PREMISE";

export interface OperatorMe {
  id: string;
  fullName: string;
  email: string;
  role: PlatformRole;
  mustChangePassword: boolean;
  twoStep: { enabled: boolean; recoveryCodesLeft: number };
}

export interface StateFields {
  state: SubscriptionState;
  readOnly: boolean;
  manual: boolean;
  endsAt: string | null;
  graceEndsAt: string | null;
  daysLeft: number | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: string;
  priceYearly: string;
  maxStaff: number | null;
  features: string[];
  active: boolean;
  sortOrder: number;
  _count?: { subscriptions: number };
}

export interface ClinicRequest {
  id: string;
  reference: string;
  clinicName: string;
  clinicNameAm: string | null;
  type: "CLINIC" | "PHARMACY" | "HOSPITAL";
  region: string;
  city: string;
  address: string | null;
  licenceNumber: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  planCode: string | null;
  staffCount: number | null;
  deployment: Deployment;
  message: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedAt: string | null;
  rejectReason: string | null;
  tenantId: string | null;
  createdAt: string;
  similar?: { id: string; name: string }[];
}

export interface ClinicRow {
  id: string;
  name: string;
  nameAm: string | null;
  type: string;
  createdAt: string;
  staff: number;
  patients: number;
  lastActivityAt: string | null;
  subscription: (StateFields & { plan: { name: string; code: string }; deployment: Deployment; billingCycle: "MONTHLY" | "YEARLY" }) | null;
}

export interface PlatformInvoiceRow {
  id: string;
  number: string;
  planName: string;
  cycle: "MONTHLY" | "YEARLY";
  periodStart: string;
  periodEnd: string;
  subtotal: string;
  vat: string;
  total: string;
  status: "OPEN" | "PAID" | "VOID";
  dueDate: string;
  issuedAt: string;
  paidAt: string | null;
  voidReason: string | null;
}

export interface PlatformPaymentRow {
  id: string;
  invoiceId: string;
  tenantId: string;
  amount: string;
  method: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  reference: string | null;
  paidAt: string;
  rejectReason: string | null;
  createdAt: string;
  invoice: { number: string; total?: string };
  clinic?: string;
}

export interface HistoryEntry {
  id: string;
  operator?: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  tenantId: string | null;
  data: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface ClinicDetail {
  tenant: { id: string; name: string; nameAm: string | null; type: string; phone: string | null; address: string | null; createdAt: string };
  admins: { id: string; fullName: string; phone: string; active: boolean; totpEnabledAt: string | null }[];
  counts: { staff: number; patients: number; visits: number };
  subscription:
    | (StateFields & {
        id: string;
        planId: string;
        plan: Plan;
        deployment: Deployment;
        billingCycle: "MONTHLY" | "YEARLY";
        status: "TRIAL" | "ACTIVE" | "CANCELLED";
        trialEndsAt: string | null;
        paidUntil: string | null;
        graceDays: number;
        suspendReason: string | null;
        cancelReason: string | null;
        cancelledAt: string | null;
        dataDeletedAt: string | null;
        notes: string | null;
      })
    | null;
  invoices: PlatformInvoiceRow[];
  payments: PlatformPaymentRow[];
  request: ClinicRequest | null;
  history: HistoryEntry[];
  checkouts: Checkout[];
  /** When the clinic last downloaded all its data. */
  lastExportAt: string | null;
  /** A cancelled clinic's records may be deleted from then on. */
  deletableFrom: string | null;
}

export interface Overview {
  counts: Record<SubscriptionState, number>;
  pendingRequests: number;
  monthlyRecurring: string;
  openInvoices: { count: number; total: string };
  pendingPayments: PlatformPaymentRow[];
  unappliedCheckouts: Checkout[];
  attention: { tenantId: string; name: string; state: SubscriptionState; endsAt: string | null; daysLeft: number | null }[];
}

export interface Checkout {
  id: string;
  reference: string;
  provider: "CHAPA" | "TELEBIRR";
  invoiceId: string;
  tenantId: string;
  amount: string;
  status: "CREATED" | "PAID" | "FAILED" | "EXPIRED";
  createdAt: string;
  completedAt: string | null;
  paymentId: string | null;
  lastError: string | null;
  clinic?: string;
}

export interface PlatformSettings {
  autoInvoice: boolean;
  invoiceDaysBefore: number;
  dataRetentionDays: number;
  online?: { CHAPA: boolean; TELEBIRR: boolean };
  publicUrl?: string | null;
  /** This cloud has the licence-signing key. */
  licences?: boolean;
  trialDays: number;
  graceDays: number;
  vatPercent: string;
  bankDetails: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
}

export interface OperatorRow {
  id: string;
  fullName: string;
  email: string;
  role: PlatformRole;
  active: boolean;
  totpEnabledAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
}

export const DEPLOYMENT_LABEL: Record<Deployment, string> = {
  CLOUD: "HMIS cloud",
  CLINIC_SERVER: "Clinic server + cloud",
  ON_PREMISE: "Own server only",
};

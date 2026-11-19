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
  termsVersion?: string | null;
  termsAcceptedAt?: string | null;
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
  /** Visits checked in over the last 30 days. */
  visits30: number;
  lastActivityAt: string | null;
  /** What the clinic brings in a month now (0 on trial, free, suspended or cancelled). */
  mrr: string;
  subscription: (StateFields & { plan: { name: string; code: string; maxStaff: number | null }; deployment: Deployment; billingCycle: "MONTHLY" | "YEARLY" }) | null;
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
  clinic?: string | null;
}

export interface ClinicDetail {
  tenant: { id: string; name: string; nameAm: string | null; type: string; phone: string | null; address: string | null; createdAt: string };
  admins: { id: string; fullName: string; phone: string; active: boolean; totpEnabledAt: string | null }[];
  counts: { staff: number; patients: number; visits: number };
  usage: ClinicUsage;
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
  notes: ClinicNote[];
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
  licenceProblem?: string | null;
  trialDays: number;
  graceDays: number;
  vatPercent: string;
  bankDetails: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  companyName: string | null;
  companyTin: string | null;
  companyAddress: string | null;
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

export interface ClinicUsage {
  days: { day: string; visits: number }[];
  visits30: number;
  visitsPrevious30: number;
  signIns30: number;
  staffSignedIn30: number;
  lastSignInAt: string | null;
  servers: { id: string; name: string; lastSeenAt: string | null; lastError: string | null; edgeVersion: string | null; createdAt: string }[];
}

export type AgeBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export interface Metrics {
  asOf: string;
  counts: Record<SubscriptionState, number>;
  mrr: string;
  arr: string;
  paying: number;
  arpa: string;
  collectedThisMonth: string;
  collectedLastMonth: string;
  collected12Months: string;
  months: { month: string; collected: string; newClinics: number; cancelled: number }[];
  byPlan: { plan: string; code: string; clinics: number; paying: number; mrr: string }[];
  byMethod: { method: string; amount: string }[];
  receivables: { total: string; ageing: Record<AgeBucket, { count: number; amount: string }> };
  trialsEndingSoon: number;
  conversion: { ended: number; converted: number; rate: number | null };
  churn: { cancelled: number; lostMrr: string };
}

export interface LedgerInvoice extends PlatformInvoiceRow {
  tenantId: string;
  clinic: string;
  paid: string;
  balance: string;
  daysLate: number;
  /** The clinic's earliest open promise to pay (OPEN invoices only); broken once its day has passed. */
  promise: { on: string; broken: boolean } | null;
}

export type NoteKind = "NOTE" | "CALL" | "PROMISE";

/** HMIS's own note on a clinic; with followUpOn, a follow-up until done. */
export interface ClinicNote {
  id: string;
  tenantId: string;
  kind: NoteKind;
  body: string;
  followUpOn: string | null;
  doneAt: string | null;
  operator: string | null;
  doneBy: string | null;
  createdAt: string;
}

export interface FollowUps {
  summary: { due: number; upcoming: number; dueMine: number };
  notes: (ClinicNote & { clinic: { id: string; name: string; phone: string | null }; owes: string; daysLate: number })[];
}

export type AnnouncementState = "scheduled" | "live" | "ended" | "withdrawn";

export interface Announcement {
  id: string;
  tenantId: string | null;
  tone: "INFO" | "WARNING";
  title: string;
  titleAm: string | null;
  body: string | null;
  bodyAm: string | null;
  startsAt: string;
  endsAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  state: AnnouncementState;
  /** The one clinic it is for; null for every clinic. */
  clinic: string | null;
  createdBy: string | null;
  withdrawnBy: string | null;
}

export interface ConsoleCounts {
  pendingRequests: number;
  pendingPayments: number;
  followUpsDue: number;
  serversOffline: number;
}

export interface InvoiceLedger {
  summary: Partial<Record<"OPEN" | "PAID" | "VOID", { count: number; total: string }>> & { OVERDUE: { count: number } };
  invoices: LedgerInvoice[];
}

export interface PaymentLedger {
  summary: { count: number; confirmed: string; pending: number };
  payments: (PlatformPaymentRow & { reviewedBy: string | null; clinic: string })[];
}

export interface InvoiceDocument {
  invoice: PlatformInvoiceRow & { tenantId: string; deployment: Deployment; paid: string; balance: string; voidedAt: string | null; payments: PlatformPaymentRow[] };
  clinic: { id: string; name: string; nameAm: string | null; address: string | null; phone: string | null; tin: string | null };
  issuer: {
    vatPercent: string;
    bankDetails: string | null;
    supportPhone: string | null;
    supportEmail: string | null;
    companyName: string | null;
    companyTin: string | null;
    companyAddress: string | null;
    publicUrl: string | null;
  };
}

export interface SearchResults {
  clinics: { id: string; name: string; nameAm: string | null; address: string | null; state: SubscriptionState | null }[];
  invoices: { id: string; number: string; tenantId: string; total: string; status: "OPEN" | "PAID" | "VOID"; clinic: string }[];
  requests: { id: string; reference: string; clinicName: string; status: "PENDING" | "APPROVED" | "REJECTED"; contactPhone: string }[];
  payments: { id: string; reference: string | null; tenantId: string; amount: string; status: string; method: string; clinic: string }[];
}

export const METHOD_LABEL: Record<string, string> = {
  CHAPA: "Chapa",
  TELEBIRR: "telebirr",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  OTHER: "Other",
};

/** A clinic's statement of account: opening balance, each invoice and payment, closing balance. */
export interface Statement {
  clinic: { id: string; name: string; nameAm: string | null; address: string | null; phone: string | null; tin: string | null; createdAt: string };
  issuer: Omit<InvoiceDocument["issuer"], "vatPercent">;
  period: { from: string; to: string };
  opening: string;
  lines: { at: string; kind: "INVOICE" | "PAYMENT"; id: string; reference: string; description: string; method?: string; debit: string; credit: string; balance: string }[];
  totals: { invoiced: string; paid: string };
  closing: string;
  open: { id: string; number: string; dueDate: string; total: string; balance: string; daysLate: number }[];
}

export interface SalesReport {
  year: number;
  years: number[];
  months: { month: string; invoices: number; voided: number; subtotal: string; vat: string; total: string; collected: string }[];
  totals: { invoices: number; voided: number; subtotal: string; vat: string; total: string; collected: string };
}

export interface VatRegister {
  period: { from: string; to: string };
  truncated: boolean;
  invoices: { id: string; number: string; tenantId: string; issuedAt: string; status: "OPEN" | "PAID" | "VOID"; planName: string; subtotal: string; vat: string; total: string; voidReason: string | null; clinic: string; tin: string | null }[];
  totals: { invoices: number; voided: number; subtotal: string; vat: string; total: string; withoutTin: number };
}

export type ServerStatus = "ok" | "error" | "offline" | "never" | "new";

export interface Health {
  cloudVersion: string;
  servers: { id: string; tenantId: string; clinic: string; name: string; lastSeenAt: string | null; lastError: string | null; edgeVersion: string | null; createdAt: string; status: ServerStatus; behind: boolean }[];
  checkouts: {
    byProvider: { provider: "CHAPA" | "TELEBIRR"; paid: number; failed: number; expired: number; waiting: number }[];
    failed: { id: string; reference: string; provider: string; tenantId: string; clinic: string; amount: string; createdAt: string; lastError: string | null }[];
    unapplied: number;
  };
  licences: { tenantId: string; clinic: string; deployment: Deployment; plan: string; state: SubscriptionState; endsAt: string; daysLeft: number }[];
  setup: { key: string; ok: boolean; label: string; fix: string }[];
}

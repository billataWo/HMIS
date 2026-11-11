import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Read at runtime on the server (NEXT_PUBLIC_* values are fixed at build time).
export const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const TOKEN_COOKIE = "hmis_token";

export type DuplicatePatient = Pick<Patient, "id" | "mrn" | "firstName" | "fatherName" | "grandfather" | "sex" | "dateOfBirth" | "phone">;

export interface RxAlert {
  type: "ALLERGY" | "INTERACTION" | "DUPLICATE";
  severity: "BLOCK" | "MAJOR" | "MODERATE";
  message: string;
  drugIds: string[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: {
      message?: string | string[];
      errors?: { field: string; message: string }[];
      alerts?: RxAlert[];
      duplicates?: DuplicatePatient[]; // registration: records that may be the same person
    },
  ) {
    super(Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? `API error ${status}`));
  }
}

/** Calls the HMIS API as the signed-in user. Sends the user to /login if the session has expired. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
    });
  } catch (cause) {
    throw new Error(`Can't reach the HMIS server at ${API_URL}. Is the API running?`, { cause });
  }
  if (res.status === 401) redirect("/login");
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  // A temporary password must be replaced before anything else works.
  if (res.status === 403 && body?.code === "PASSWORD_CHANGE_REQUIRED") redirect("/account/password");
  // Admins must set up two-step sign-in before anything else.
  if (res.status === 403 && body?.code === "TWO_STEP_SETUP_REQUIRED") redirect("/account/two-step");
  if (!res.ok) throw new ApiError(res.status, body ?? {});
  return body as T;
}

export type SubscriptionState = "trial" | "active" | "overdue" | "suspended" | "cancelled";

export interface PlatformInvoice {
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
  payments: { id: string; amount: string; method: string; status: "PENDING" | "CONFIRMED" | "REJECTED"; reference: string | null; paidAt: string; rejectReason: string | null }[];
  paid: string;
}

export type ClinicSubscription =
  | { managed: false }
  | {
      managed: true;
      state: SubscriptionState;
      readOnly: boolean;
      manual: boolean;
      endsAt: string | null;
      graceEndsAt: string | null;
      daysLeft: number | null;
      planName: string;
      deployment: "CLOUD" | "CLINIC_SERVER" | "ON_PREMISE";
      billingCycle: "MONTHLY" | "YEARLY";
      suspendReason: string | null;
      plan: { name: string; code: string; description: string | null; priceMonthly: string | null; priceYearly: string | null; maxStaff: number | null; features: { code: string; name: string }[] } | null;
      activeStaff: number;
      invoices: PlatformInvoice[];
      online: { CHAPA: boolean; TELEBIRR: boolean };
      bankDetails: string | null;
      support: { phone: string | null; email: string | null };
      /** "licence": a clinic server or own-server install, run by its HMIS licence. */
      source: "subscription" | "licence";
      unlicensed?: boolean;
      licence?: { id: string; issuedAt: string; source: "sync" | "upload"; installedAt: string; clinicName: string } | null;
      /** Where a synced clinic's admins pay HMIS (the cloud). */
      payAt?: string | null;
    };

export type Role = "ADMIN" | "RECEPTIONIST" | "DOCTOR" | "NURSE" | "CASHIER" | "PHARMACIST" | "LAB_TECH";

export interface Me {
  id: string;
  fullName: string;
  phone: string;
  role: Role;
  mustChangePassword?: boolean;
  twoStep?: { enabled: boolean; required: boolean };
  /** The modules in the clinic's plan; null: every module. */
  features?: string[] | null;
  /** null: the clinic is not billed as a service (no limits). */
  subscription?: { state: SubscriptionState; readOnly: boolean; daysLeft: number | null; endsAt: string | null; planName: string | null; source?: string; unlicensed?: boolean } | null;
  tenant: { id: string; name: string; nameAm: string | null; doctorsCanRegister?: boolean };
}

export interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  fatherName: string;
  grandfather: string | null;
  firstNameAm: string | null;
  fatherNameAm: string | null;
  sex: "MALE" | "FEMALE";
  dateOfBirth: string | null;
  phone: string | null;
  address: string | null;
  familyId: string | null;
  allergies: string[];
  createdAt: string;
}

export interface PatientDetail extends Patient {
  family: Pick<Patient, "id" | "mrn" | "firstName" | "fatherName" | "sex" | "dateOfBirth">[];
  visits: {
    id: string;
    checkedInAt: string;
    status: string;
    queueNumber: number;
    kind?: "OPD" | "WALK_IN"; // WALK_IN: a pharmacy counter sale, not a consultation
    doctor: { fullName: string } | null;
    // Only sent to clinical staff (admin, doctor, nurse).
    chiefComplaint?: string | null;
    diagnoses?: { icd11Code: string; label: string }[];
  }[];
}

export type VisitStatus = "WAITING" | "IN_CONSULTATION" | "AWAITING_LAB" | "AWAITING_PHARMACY" | "COMPLETED" | "CANCELLED";

export type QueuePatient = Pick<
  Patient,
  "id" | "mrn" | "firstName" | "fatherName" | "grandfather" | "firstNameAm" | "fatherNameAm" | "sex" | "dateOfBirth" | "phone" | "allergies"
>;

export interface QueueVisit {
  id: string;
  queueNumber: number;
  status: VisitStatus;
  checkedInAt: string;
  calledAt: string | null;
  completedAt: string | null;
  patient: QueuePatient;
  doctor: { id: string; fullName: string; room?: string | null } | null;
  consultationPaid?: boolean; // present on /queue
  labReady?: boolean; // present on /queue: every ordered test is verified
  labPending?: boolean; // present on /queue: some test has no verified result yet
  rxPending?: boolean; // present on /queue: drugs still to hand over
  carriedOver?: boolean; // present on /queue: an unfinished visit from an earlier day
  diagnosed?: boolean; // present on /queue: at least one diagnosis recorded
  owed?: string; // present on /queue: unpaid charges other than the consultation fee
}

export interface QueueResponse {
  day: string;
  prepayment: boolean;
  visits: QueueVisit[];
}

export interface LabTest {
  id: string;
  name: string;
  loincCode: string | null;
  unit: string | null;
  refLow: string | null;
  refHigh: string | null;
  price: string;
  resultOptions: string[];
  /** Panel tests (CBC, urinalysis…): one result per component, each with its own range or answers. */
  components?: LabComponent[];
}

export interface LabComponent {
  id: string;
  name: string;
  unit: string | null;
  refLow: string | null;
  refHigh: string | null;
  resultOptions: string[];
}

export interface LabValueEntry {
  componentId: string;
  value: string;
  flag: "L" | "H" | "N" | null;
}

export type LabStatus = "ORDERED" | "SAMPLE_COLLECTED" | "RESULTED" | "VERIFIED" | "CANCELLED";

export interface LabOrder {
  id: string;
  status: LabStatus;
  sampleId: string | null;
  sampleCollectedAt: string | null;
  resultValue: string | null;
  resultFlag: "L" | "H" | "N" | null;
  resultNote: string | null;
  orderedAt: string;
  resultedAt: string | null;
  verifiedAt: string | null;
  labTest: Omit<LabTest, "price">;
  values?: LabValueEntry[]; // panel results (empty until verified for clinicians)
  orderedBy: { id: string; fullName: string };
  collectedBy: { fullName: string } | null;
  resultedBy: { fullName: string } | null;
  verifiedBy: { fullName: string } | null;
}

export interface LabWorkOrder extends LabOrder {
  paid?: boolean;
  visit: { id: string; queueNumber: number; patient: QueuePatient };
}

export interface LabReport {
  id: string;
  checkedInAt: string;
  patient: QueuePatient;
  doctor: { fullName: string } | null;
  tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null };
  labOrders: LabOrder[];
}

export interface InventoryRow {
  id: string;
  genericName: string;
  brandName: string | null;
  drugClass: string | null;
  form: string;
  strength: string | null;
  unit: string;
  sellPrice: string;
  reorderLevel: number;
  active: boolean;
  onHand: number;
  expiringSoon: number;
  expiredQty: number;
  nearestExpiry: string | null;
  stockValue: string;
  expiredValue: string;
  low: boolean;
}

export interface InventoryResponse {
  summary: { drugs: number; stockValue: string; low: number; expiring: number; expired: number; expiredValue: string; expiryWarningDays: number };
  drugs: InventoryRow[];
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  contactPerson: string | null;
  tin: string | null;
  active: boolean;
}

export interface DrugStock {
  drug: Omit<InventoryRow, "onHand" | "expiringSoon" | "expiredQty" | "nearestExpiry" | "stockValue" | "expiredValue" | "low">;
  batches: {
    id: string;
    batchNo: string;
    expiryDate: string;
    quantity: number;
    costPrice: string;
    supplier: string | null;
    supplierRef: { name: string } | null;
    receiptRef: string | null;
    receivedAt: string;
    expired: boolean;
  }[];
  movements: {
    id: string;
    type: "RECEIPT" | "DISPENSE" | "ADJUSTMENT" | "EXPIRED" | "TRANSFER_OUT" | "TRANSFER_IN";
    quantity: number;
    reference: string | null;
    reason: string | null;
    createdAt: string;
    userName: string | null;
    batch: { batchNo: string };
  }[];
}

export interface CatalogService {
  id: string;
  code: string;
  name: string;
  price: string;
  kind?: "CONSULTATION" | "PROCEDURE";
  active: boolean;
}

export interface CatalogLabTest extends LabTest {
  active: boolean;
}

export interface Dashboard {
  from: string;
  to: string;
  patients: { visits: number; completed: number; newPatients: number; avgWaitMinutes: number | null; byDoctor: { name: string; count: number }[] };
  revenue: {
    collected: string;
    byMethod: Partial<Record<PaymentMethod, string>>;
    billed: string;
    discounts: string;
    unbilled: string;
    unbilledCount: number;
    patientsOwe: string;
    receivables: { payer: string; due: string }[];
  };
  topDiagnoses: { code: string; label: string; count: number }[];
  lab: { ordered: number; verified: number; abnormal: number; topTests: { name: string; count: number }[] };
  pharmacy: { sales: string; unitsDispensed: number; topDrugs: { name: string; units: number }[] };
  stock: { value: string; low: number; expiring: number; expiredOnShelf: number; expiredLoss: string; adjustmentLoss: string };
  daily: { day: string; visits: number; collected: string }[];
}

export interface MohReport {
  facility: { name: string; nameAm: string | null; address: string | null };
  period: { ecYear: number; ecMonth: number; label: string; labelAm: string; startDay: string; endDay: string };
  opd: {
    total: number;
    male: number;
    female: number;
    newVisits: number;
    repeatVisits: number;
    byAge: { ageGroup: string; male: number; female: number }[];
    withoutDiagnosis: number;
  };
  morbidity: { code: string; label: string; male: number; female: number; total: number }[];
  malaria: { tested: number; positive: number; byResult: { result: string; count: number }[] };
}

export interface ClinicSettings {
  id: string;
  name: string;
  nameAm: string | null;
  phone: string | null;
  address: string | null;
  requirePrepayment: boolean;
  doctorsCanRegister: boolean;
}

export interface Diagnosis {
  id: string;
  icd11Code: string;
  label: string;
  isPrimary: boolean;
}

export const VITAL_FIELDS = ["temperatureC", "pulse", "systolicBp", "diastolicBp", "respRate", "spo2", "weightKg", "heightCm"] as const;
export const NOTE_FIELDS = ["chiefComplaint", "history", "examination", "plan"] as const;
export type VitalField = (typeof VITAL_FIELDS)[number];
export type NoteField = (typeof NOTE_FIELDS)[number];

/** Decimal vitals arrive from the API as strings ("38.6"); integer ones as numbers. */
export type VisitDetail = QueueVisit &
  Record<VitalField, string | number | null> &
  Record<NoteField, string | null> & {
    kind: "OPD" | "WALK_IN";
    prepayment: boolean;
    consultationPaid: boolean;
    owed: string; // all unpaid charges of the visit
    diagnoses: Diagnosis[];
    previous: {
      id: string;
      checkedInAt: string;
      chiefComplaint: string | null;
      plan: string | null;
      systolicBp: number | null;
      diastolicBp: number | null;
      weightKg: string | null;
      doctor: { fullName: string } | null;
      diagnoses: Omit<Diagnosis, "id">[];
    }[];
  };

export interface IcdEntry {
  code: string;
  label: string;
  labelAm?: string;
}

export interface DrugOption {
  id: string;
  genericName: string;
  brandName: string | null;
  drugClass: string | null;
  form: string;
  strength: string | null;
  unit: string;
  sellPrice: string;
  inStock: number;
}

export type Frequency = "OD" | "BID" | "TID" | "QID" | "NOCTE" | "PRN" | "STAT";

export interface PrescriptionItem {
  id: string;
  dose: string;
  frequency: Frequency;
  durationDays: number | null;
  quantity: number;
  instructions: string | null;
  billedQty: number;
  dispensedQty: number;
  paidQty?: number; // present on the pharmacy worklist
  drug: Pick<DrugOption, "id" | "genericName" | "brandName" | "form" | "strength" | "unit" | "sellPrice">;
  inStock?: number; // present on the pharmacy worklist
}

export interface Prescription {
  id: string;
  status: "PENDING" | "PARTIALLY_DISPENSED" | "DISPENSED" | "CANCELLED";
  createdAt: string;
  dispensedAt: string | null;
  alerts: RxAlert[] | null;
  overrideReason: string | null;
  prescriber: { id: string; fullName: string };
  items: PrescriptionItem[];
}

export interface PharmacyPrescription extends Prescription {
  visit: { id: string; queueNumber: number; status: VisitStatus; kind?: "OPD" | "WALK_IN"; patient: QueuePatient };
}

export interface Charge {
  id: string;
  source: "CONSULTATION" | "LAB" | "PHARMACY" | "PROCEDURE" | "OTHER";
  description: string;
  quantity: number;
  unitPrice: string;
  createdAt: string;
  voidedAt?: string | null; // removed from the invoice and refunded: never delivered
  voidReason?: string | null;
}

export interface PendingBill {
  id: string; // visit id
  queueNumber: number;
  checkedInAt: string;
  status: VisitStatus;
  patient: QueuePatient;
  doctor: { fullName: string } | null;
  charges: Charge[];
  subtotal: string;
}

export type PaymentMethod = "CASH" | "TELEBIRR" | "CHAPA" | "BANK_TRANSFER";
export type InvoiceStatus = "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID";

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  payerType: "SELF" | "CREDIT" | "INSURANCE";
  payerName: string | null;
  subtotal: string;
  discount: string;
  discountReason: string | null;
  total: string;
  paid: string;
  balance: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  patient: QueuePatient;
  createdBy: { fullName: string };
}

export interface InvoiceDetail extends Invoice {
  charges: Charge[];
  // A negative amount is a refund; `note` says why.
  payments: { id: string; method: PaymentMethod; amount: string; reference: string | null; note: string | null; receivedAt: string; cashier: { id: string; fullName: string } }[];
  visit: { id: string; queueNumber: number; checkedInAt: string } | null;
  tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null };
}

export interface DailySummary {
  day: string;
  collected: string;
  byMethod: Partial<Record<PaymentMethod, string>>;
  cashiers: { cashier: { id: string; fullName: string }; byMethod: Partial<Record<PaymentMethod, string>>; total: string }[];
  invoices: { count: number; billed: string; discounts: string; unpaid: string; voided: number };
  closings: { id: string; cashier: { id: string; fullName: string }; expectedCash: string; countedCash: string; variance: string; note: string | null; createdAt: string }[];
}

export interface Appointment {
  id: string;
  scheduledAt: string;
  reason: string | null;
  status: "BOOKED" | "ARRIVED" | "CANCELLED" | "NO_SHOW";
  patient: QueuePatient;
  doctor: { id: string; fullName: string } | null;
  visit: { id: string; queueNumber: number; status: VisitStatus } | null;
}

export interface Doctor {
  id: string;
  fullName: string;
  /** Where they see patients ("Room 2"), shown on the waiting-room screen. */
  room?: string | null;
}

export interface Service {
  id: string;
  code: string;
  name: string;
  price: string;
  kind?: "CONSULTATION" | "PROCEDURE"; // procedures are recorded during the visit
}

export interface ProcedureCharge {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  invoiceId: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; fullName: string; role: Role } | null;
}

export interface ClinicalDocument {
  id: string;
  type: "MEDICAL_CERTIFICATE" | "REFERRAL";
  data: Record<string, string | number>;
  createdAt: string;
}

export interface ClinicalDocumentDetail extends ClinicalDocument {
  visit: {
    id: string;
    checkedInAt: string;
    patient: QueuePatient;
    tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null };
    diagnoses: { icd11Code: string; label: string; isPrimary: boolean }[];
  };
}

export interface Payer {
  id: string;
  type: "CREDIT" | "INSURANCE";
  name: string;
  phone: string | null;
  contactPerson: string | null;
  active: boolean;
  balance?: string;
  openInvoices?: number;
}

export interface PayerStatement {
  payer: Payer;
  tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null };
  from: string;
  to: string;
  billed: string;
  balance: string;
  invoices: StatementInvoice[];
  unpaid: StatementInvoice[];
}

export interface StatementInvoice {
  id: string;
  number: string;
  createdAt: string;
  status: InvoiceStatus;
  total: string;
  paid: string;
  balance: string;
  patient: QueuePatient;
  charges: { description: string; quantity: number; unitPrice: string }[];
}

export type PurchaseOrderStatus = "DRAFT" | "ORDERED" | "PARTLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export interface PurchaseOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  note: string | null;
  createdAt: string;
  orderedAt: string | null;
  total: string;
  supplier: { id: string; name: string; phone: string | null; contactPerson: string | null; tin: string | null };
  lines: { id: string; quantity: number; unitCost: string | null; receivedQty: number; drug: { id: string; genericName: string; strength: string | null; form: string; unit: string; sellPrice?: string } }[];
  tenant?: { name: string; nameAm: string | null; phone: string | null; address: string | null };
}

export interface StaffUser {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: Role;
  room?: string | null;
  active: boolean;
  createdAt: string;
  totpEnabledAt?: string | null; // two-step sign-in is on
}

export type BackupCheckStatus = "ok" | "warning" | "failing";

export interface BackupEventRow {
  id: string;
  kind: "BACKUP" | "OFFSITE_SYNC" | "CHECK" | "RESTORE_TEST" | "VERIFY" | "ARCHIVE" | "RESTORE";
  status: "OK" | "WARNING" | "FAILED";
  detail: string | null;
  message: string | null;
  sizeBytes: number | null;
  startedAt: string;
  finishedAt: string;
}

/** GET /backups/status: the server's backup health, from the backup worker's events. */
export interface BackupStatus {
  monitored: boolean;
  overall: BackupCheckStatus;
  banner: string | null;
  site: string | null;
  lastBackup: { at: string; type: string | null; databaseBytes: number | null } | null;
  restoreWindow: { from: string | null; to: string | null } | null;
  offsite: { configured: boolean; location: string | null; lastCopiedAt: string | null };
  lastRestoreTest: { at: string; ok: boolean; recoverySeconds: number | null } | null;
  lastRestore: { at: string; message: string | null } | null;
  checks: { key: string; label: string; status: BackupCheckStatus; detail: string; at: string | null }[];
  recent: BackupEventRow[];
}

/** GET /sync/status: how this clinic's data moves between its clinic server and the cloud. */
export interface SyncStatus {
  mode: "clinic-server" | "cloud-copy" | "off";
  lastSyncAt: string | null;
  // admins only
  clients?: { name: string; lastSeenAt: string | null; appliedRows: number; lastError: string | null; edgeVersion: string | null }[];
  cloudUrl?: string | null;
  enabledAt?: string | null;
  pushedRows?: number;
  lastError?: string | null;
  lastErrorAt?: string | null;
  waiting?: number;
  oldestWaitingAt?: string | null;
}

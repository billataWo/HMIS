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
  /** In search results: the coverages they can be checked in on. */
  coverages?: CoverageOption[];
  /** In the front desk's search (balance=1): what they owe, and how much from before today. */
  balance?: PatientBalance;
}

/** What a patient still owes, by visit; "earlier" is from visits before today. */
export interface PatientBalance {
  owed: string;
  earlier: string;
  visits: { visitId: string; checkedInAt: string; kind: "OPD" | "WALK_IN" | "LAB"; owed: string }[];
}

/** A coverage the front desk can check the patient in on (their payer, member number, end date). */
export interface CoverageOption {
  id: string;
  memberId: string | null;
  validUntil: string | null;
  payer: { id: string; name: string; type: "CREDIT" | "INSURANCE"; coPayPercent: string; requiresAuthorization: boolean; active?: boolean };
}

/** A patient's coverage as kept on their record. */
export interface PatientCoverage extends CoverageOption {
  holder: string | null;
  active: boolean;
  createdAt: string;
}

export interface PatientDetail extends Patient {
  family: Pick<Patient, "id" | "mrn" | "firstName" | "fatherName" | "sex" | "dateOfBirth">[];
  visits: {
    id: string;
    checkedInAt: string;
    status: string;
    queueNumber: number;
    kind?: "OPD" | "WALK_IN" | "LAB"; // WALK_IN: a pharmacy counter sale, not a consultation
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
  labAlert?: "CRITICAL" | "AMENDED" | null; // present on /queue: a released result the doctor hasn't seen yet
  labRecollect?: boolean; // present on /queue: the lab rejected a sample; a new one is needed
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
  critLow?: string | null; // critical (panic) limits
  critHigh?: string | null;
  price: string;
  resultOptions: string[];
  /** Target turnaround, sample taken to result released (minutes); null = no target. */
  tatMinutes?: number | null;
  /** The sample and tube (EDTA, SERUM, URINE…; see lib/specimens); tests with the same one share a tube. */
  specimen?: string | null;
  /** Not done here: sent to a reference lab (usually this one). */
  sendOut?: boolean;
  referenceLab?: string | null;
  /** Panel tests (CBC, urinalysis…): one result per component, each with its own range or answers. */
  components?: LabComponent[];
  /** Ranges for men, women and age groups (the test's own range is the default). */
  ranges?: LabRange[];
}

export interface LabRange {
  id?: string;
  componentId?: string | null;
  sex: "MALE" | "FEMALE" | null;
  ageFromDays: number;
  ageToDays: number | null;
  refLow: string | null;
  refHigh: string | null;
  critLow: string | null;
  critHigh: string | null;
}

export interface LabComponent {
  id: string;
  name: string;
  unit: string | null;
  refLow: string | null;
  refHigh: string | null;
  critLow?: string | null;
  critHigh?: string | null;
  resultOptions: string[];
  ranges?: LabRange[];
}

export interface LabValueEntry {
  componentId: string;
  value: string;
  flag: LabFlag | null;
  rangeText?: string | null;
}

export type LabStatus = "ORDERED" | "SAMPLE_COLLECTED" | "RESULTED" | "VERIFIED" | "CANCELLED";

/** LL / L / N / H / HH: double letters are beyond a critical limit. */
export type LabFlag = "LL" | "L" | "N" | "H" | "HH";

export interface LabOrder {
  id: string;
  status: LabStatus;
  /** Lab-only visits: who asked for the test (a doctor or clinic outside). */
  requestedBy?: string | null;
  /** Needed now (STAT): first on the bench, with the clinic's shorter target. */
  urgent?: boolean;
  sampleId: string | null;
  sampleCollectedAt: string | null;
  /** At a reference lab: where, its number there, and since when. */
  sentTo?: string | null;
  sentRef?: string | null;
  sentAt?: string | null;
  resultValue: string | null;
  resultFlag: LabFlag | null;
  /** The range the result was judged by, as printed ("13–17 g/dL (men)"). */
  rangeText?: string | null;
  /** Beyond a critical limit: phoned to the doctor before release. */
  critical?: boolean;
  criticalNotified?: string | null;
  criticalNotifiedAt?: string | null;
  /** A released result the doctor must look at: CRITICAL or AMENDED, until marked seen. */
  alert?: "CRITICAL" | "AMENDED" | null;
  alertSeenAt?: string | null;
  amendedAt?: string | null;
  amendments?: { id: string; previousValue: string | null; previousFlag: string | null; reason: string; createdAt: string }[];
  /** Rejected samples, and the last reason while a new sample is awaited. */
  rejections?: number;
  rejectReason?: string | null;
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
  /** Minutes from the sample to release this test should take (urgent or the test's own); null = none. */
  targetMinutes?: number | null;
  visit: { id: string; queueNumber: number; kind?: "OPD" | "WALK_IN" | "LAB"; patient: QueuePatient };
}

/** A released result in a patient's lab history. */
export interface LabHistoryOrder extends LabOrder {
  visit: { id: string; kind: "OPD" | "WALK_IN" | "LAB" };
}

/** Where a test's QC stands: FAIL holds patient results; DUE = not run today; WARN = a 1-2s today. */
export interface QcState {
  status: "OK" | "WARN" | "DUE" | "FAIL";
  detail: string | null;
}

export interface LabQcRun {
  id: string;
  value: string;
  /** Standard deviations from the mean (measured controls). */
  z: string | null;
  status: "PASS" | "WARN" | "FAIL";
  rule: string | null;
  note: string | null;
  action: string | null;
  createdAt: string;
}

export interface LabQcControl {
  id: string;
  labTestId: string;
  name: string;
  lot: string | null;
  expiresAt: string | null;
  mean: string | null;
  sd: string | null;
  expected: string | null;
  active: boolean;
  /** Newest first. */
  results: LabQcRun[];
}

export interface LabQcPage {
  today: string;
  tests: { id: string; name: string; unit: string | null; resultOptions: string[]; state: QcState; controls: LabQcControl[] }[];
  allTests: { id: string; name: string; unit: string | null; resultOptions: string[] }[];
}

export interface LabReagentLot {
  id: string;
  lot: string | null;
  expiresAt: string | null;
  quantity: number;
  receivedAt: string;
}

export interface LabReagentRow {
  id: string;
  name: string;
  unit: string;
  reorderLevel: number;
  active: boolean;
  lots: LabReagentLot[];
  uses: { labTestId: string; perTest: number; labTest: { id: string; name: string } }[];
  onHand: number;
  low: boolean;
  expiringSoon: number;
  expired: number;
  /** Used by tests with none on record since the last count. */
  usedWithoutStock: number;
}

export interface LabReagentsPage {
  reagents: LabReagentRow[];
  tests: { id: string; name: string }[];
  adjustReasons: Record<string, string>;
}

export interface LabReagentMovement {
  id: string;
  type: "RECEIVE" | "USE" | "QC" | "ADJUST" | "EXPIRED";
  quantity: number;
  reason: string | null;
  labOrderId: string | null;
  createdAt: string;
  lotRow: { lot: string | null } | null;
}

/** Samples at reference labs, and those sent on a day (the dispatch list). */
export interface LabSendOuts {
  day: string;
  tenant: { name: string; phone: string | null; address: string | null };
  outstanding: LabWorkOrder[];
  sent: LabWorkOrder[];
}

/** One label per sample tube or container. */
export interface LabLabels {
  visitId: string;
  tenant: { name: string };
  patient: QueuePatient;
  tubes: { sampleId: string; specimen: string | null; collectedAt: string | null; urgent: boolean; tests: string[] }[];
}

export interface LabReport {
  id: string;
  kind?: "OPD" | "WALK_IN" | "LAB";
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
  packSize: number | null; // units per pack as bought
  packName: string | null;
  controlled: ControlledClass | null;
  active: boolean;
  onHand: number;
  expiringSoon: number;
  expiredQty: number;
  nearestExpiry: string | null;
  stockValue: string;
  expiredValue: string;
  low: boolean;
  byStore?: { storeId: string; name: string; quantity: number }[]; // several stores: usable units per store
}

/** A place stock is kept (several stores): dispensing takes only from dispensary stores. */
export interface Store {
  id: string;
  name: string;
  dispensary: boolean;
  active: boolean;
  drugs: number; // drugs with usable stock there
  units: number;
}

export interface StockTransfer {
  id: string;
  number: string;
  from: string;
  to: string;
  note: string | null;
  by: string | null;
  createdAt: string;
  lines: { drug: { id: string; genericName: string; strength: string | null; form: string; unit: string }; batchNo: string; expiryDate: string; quantity: number }[];
}

export interface InventoryResponse {
  summary: { multiStore?: boolean; drugs: number; stockValue: string; low: number; expiring: number; expired: number; expiredValue: string; expiryWarningDays: number };
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
    store?: { name: string } | null; // several stores: where the batch is kept
    receiptRef: string | null;
    receivedAt: string;
    expired: boolean;
  }[];
  movements: {
    id: string;
    type: StockMovementType;
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

/** Released tests: count, median minutes sample → release, and how many of those with a target met it. */
export interface TatSummary {
  count: number;
  medianMinutes: number | null;
  withTarget: number;
  onTime: number;
}
export interface LabTurnaround extends TatSummary {
  orderToReleaseMinutes: number | null;
  urgent: TatSummary;
  tests: (TatSummary & { name: string; targetMinutes: number | null })[];
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
    /** What is owed by age (0–30, 31–60, 61–90, over 90 days), by patients and by payers. */
    ageing?: { patients: string[]; payers: string[] };
    /** Discounts and exemptions in the period, by category. */
    discountsBy?: { category: string; count: number; amount: string }[];
  };
  topDiagnoses: { code: string; label: string; count: number }[];
  lab: {
    ordered: number;
    verified: number;
    abnormal: number;
    critical?: number;
    urgent?: number;
    topTests: { name: string; count: number }[];
    turnaround?: LabTurnaround;
  };
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
  multiStore: boolean; // a main store and a dispensary (or more), with transfers
  labUrgentMinutes?: number; // target for urgent lab tests, sample to release
  tin?: string | null; // taxpayer identification number, on receipts
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
    kind: "OPD" | "WALK_IN" | "LAB";
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
      prescriptions: {
        items: { dose: string; frequency: Frequency; durationDays: number | null; drug: { genericName: string; strength: string | null; form: string } }[];
      }[];
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
  packSize?: number | null;
  packName?: string | null;
  controlled?: ControlledClass | null;
  inStock: number;
}

/** Narcotic or psychotropic: kept in the controlled-drug register, never sold over the counter. */
export type ControlledClass = "NARCOTIC" | "PSYCHOTROPIC";

export interface RegisterLine {
  id: string;
  at: string;
  type: StockMovementType;
  batchNo: string;
  expiryDate: string;
  in: number;
  out: number;
  balance: number;
  by: string | null;
  supplier: string | null;
  reference: string | null;
  reason: string | null;
  patient: { id: string; mrn: string; firstName: string; fatherName: string; grandfather: string | null } | null;
  prescriber: string | null;
  prescriptionId: string | null;
}

export interface ControlledRegister {
  from: string;
  to: string;
  drugs: {
    id: string;
    genericName: string;
    brandName: string | null;
    strength: string | null;
    form: string;
    unit: string;
    controlled: ControlledClass;
    opening: number;
    received: number;
    issued: number;
    closing: number;
    lines: RegisterLine[];
  }[];
}

/** A medicine on the starter list (no price: the clinic sets it). */
export interface FormularyDrug {
  group: string;
  genericName: string;
  strength: string | null;
  form: string;
  unit: string;
  drugClass: string | null;
  packSize?: number;
  packName?: string;
  controlled?: ControlledClass;
  inList: boolean;
}

/** One drug to add (starter list, spreadsheet import). */
export interface NewDrug {
  genericName: string;
  brandName?: string | null;
  drugClass?: string | null;
  form: string;
  strength?: string | null;
  unit: string;
  sellPrice: number;
  reorderLevel?: number;
  packSize?: number | null;
  packName?: string | null;
  controlled?: ControlledClass | null;
}

export type StockMovementType = "RECEIPT" | "DISPENSE" | "ADJUSTMENT" | "EXPIRED" | "TRANSFER_OUT" | "TRANSFER_IN" | "RETURN";

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
  returnedQty: number; // brought back by the patient after being handed over
  refundedQty: number; // of those, units whose charge was taken back
  substitutedFrom?: string | null; // another brand was given instead of this (what was prescribed)
  substitutionReason?: string | null;
  paidQty?: number; // present on the pharmacy worklist
  drug: Pick<DrugOption, "id" | "genericName" | "brandName" | "form" | "strength" | "unit" | "sellPrice" | "controlled">;
  inStock?: number; // present on the pharmacy worklist
  elsewhere?: number; // several stores: usable units in stores other than the dispensary
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
  visit: { id: string; queueNumber: number; status: VisitStatus; kind?: "OPD" | "WALK_IN" | "LAB"; patient: QueuePatient };
}

/** One entry of a patient's medication history. */
export interface Medication extends Prescription {
  visit: { id: string; kind: "OPD" | "WALK_IN" | "LAB"; checkedInAt: string };
}

/** What a medicine label prints. */
export interface RxLabel extends Omit<Prescription, "items"> {
  visit: { id: string; kind: "OPD" | "WALK_IN" | "LAB"; patient: QueuePatient };
  tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null };
  dispensedBy: string | null;
  items: (PrescriptionItem & { batches: string[]; expiresAt: string | null })[];
}

/** A line of the pharmacy's returns register. */
export interface DrugReturnRow {
  id: string;
  quantity: number;
  restocked: boolean;
  reason: string;
  createdAt: string;
  prescriptionItem: {
    drug: { genericName: string; strength: string | null; form: string; unit: string };
    prescription: { visit: { patient: { id: string; mrn: string; firstName: string; fatherName: string } } };
  };
}

export interface ReturnResult {
  id: string;
  quantity: number;
  restocked: boolean;
  unit: string;
  /** Returned units still charged on an invoice: an admin refunds them there. */
  refundDue: number;
  invoices: { id: string; number: string }[];
}

export interface Charge {
  id: string;
  source: "CONSULTATION" | "LAB" | "PHARMACY" | "PROCEDURE" | "OTHER";
  description: string;
  quantity: number;
  unitPrice: string;
  /** Covered by this payer (at its price); null: the patient pays it. */
  payerId?: string | null;
  createdAt: string;
  voidedAt?: string | null; // removed from the invoice and refunded: never delivered
  voidReason?: string | null;
}

export interface PendingBill {
  id: string; // visit id
  queueNumber: number;
  checkedInAt: string;
  status: VisitStatus;
  patient: QueuePatient & { coverages?: CoverageOption[] };
  doctor: { fullName: string } | null;
  charges: Charge[];
  subtotal: string;
  /** Billed to a payer: how much it covers, and what the patient pays (co-payment and anything not covered). */
  payer?: { id: string; name: string; type: "CREDIT" | "INSURANCE" } | null;
  covered?: string;
  patientPart?: string;
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
  /** Why it was reduced or waived (see DISCOUNT_CATEGORIES). */
  discountCategory?: string | null;
  /** Times the receipt was printed: a reprint says COPY. */
  receiptPrints?: number;
  total: string;
  paid: string;
  balance: string;
  /** On a payer's invoice: the patient's co-payment, what of it is paid, and what each side still owes. */
  patientShare?: string;
  patientPaid?: string;
  patientDue?: string;
  payerDue?: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  patient: QueuePatient;
  createdBy: { fullName: string };
}

export interface InvoiceDetail extends Invoice {
  charges: Charge[];
  // A negative amount is a refund; `note` says why.
  payments: { id: string; method: PaymentMethod; amount: string; reference: string | null; note: string | null; byPayer?: boolean; reversalOfId?: string | null; receivedAt: string; cashier: { id: string; fullName: string } }[];
  visit: { id: string; queueNumber: number; checkedInAt: string; memberId?: string | null; authorizationNo?: string | null; coPayPercent?: string | null } | null;
  tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null; tin?: string | null };
}

export interface DailySummary {
  day: string;
  collected: string;
  byMethod: Partial<Record<PaymentMethod, string>>;
  cashiers: { cashier: { id: string; fullName: string }; byMethod: Partial<Record<PaymentMethod, string>>; total: string }[];
  invoices: { count: number; billed: string; discounts: string; unpaid: string; voided: number };
  /** Shift closings, in order (a cashier may close several a day). */
  closings: {
    id: string;
    cashier: { id: string; fullName: string };
    periodStart: string;
    openingFloat: string;
    expectedCash: string;
    countedCash: string;
    floatLeft: string;
    handedTo: string | null;
    variance: string;
    note: string | null;
    createdAt: string;
  }[];
}

/** The signed-in cashier's open shift: since when, what was taken, and the float to start from. */
export interface CashShift {
  periodStart: string;
  payments: number;
  totals: Partial<Record<PaymentMethod, string>>;
  cash: string;
  suggestedFloat: string;
  lastClosing: { id: string; createdAt: string; day: string } | null;
}

export interface Appointment {
  id: string;
  scheduledAt: string;
  reason: string | null;
  status: "BOOKED" | "ARRIVED" | "CANCELLED" | "NO_SHOW";
  patient: QueuePatient & { coverages?: CoverageOption[] };
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
  /** The patient's share of each covered bill, in percent. */
  coPayPercent?: string;
  requiresAuthorization?: boolean;
  balance?: string;
  openInvoices?: number;
}

/** A payer's price list: every item with the clinic's price, and the payer's own price or exclusion. */
export interface PayerTariff {
  payer: Payer;
  items: { itemType: "SERVICE" | "LAB" | "DRUG"; itemId: string; name: string; cashPrice: string; price: string | null; excluded: boolean }[];
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
  /** What the payer owes on it (its share, less what it paid). */
  balance: string;
  payerShare?: string;
  patientShare?: string;
  patient: QueuePatient;
  /** What a claim needs: the member and authorization numbers, the doctor and the diagnoses. */
  visit?: {
    checkedInAt: string;
    memberId: string | null;
    authorizationNo: string | null;
    doctor: { fullName: string } | null;
    diagnoses: { icd11Code: string; label: string; isPrimary: boolean }[];
  } | null;
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

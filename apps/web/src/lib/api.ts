import "server-only";
import { statusDigest } from "./http-status";
import { cookies, headers } from "next/headers";
import type { AuditCategory } from "./audit-actions";
import { addressFrom } from "./client-address";
import { redirect } from "next/navigation";

// Read at runtime on the server (NEXT_PUBLIC_* values are fixed at build time).
export const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const TOKEN_COOKIE = "hmis_token";

export type DuplicatePatient = Pick<Patient, "id" | "mrn" | "firstName" | "fatherName" | "grandfather" | "sex" | "dateOfBirth" | "phone">;

export interface RxAlert {
  type: "ALLERGY" | "INTERACTION" | "DUPLICATE" | "PREGNANCY" | "BREASTFEEDING";
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
    this.digest = statusDigest(status);
  }
  /** Carries the status to the error page in the browser (lib/http-status.ts): "not found", "no access". */
  digest: string;
}

/** Calls the HMIS API as the signed-in user. Sends the user to /login if the session has expired. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) redirect("/login");
  // Who is really asking, for the audit log: the user's address and browser, not this web server's.
  const incoming = await headers();
  const forwarded = addressFrom(incoming.get("x-forwarded-for"));
  const agent = incoming.get("user-agent");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(forwarded && { "X-Forwarded-For": forwarded }),
        ...(agent && { "User-Agent": agent.slice(0, 300) }),
        ...init.headers,
      },
    });
  } catch (cause) {
    throw Object.assign(new Error(`Can't reach the HMIS server at ${API_URL}. Is the API running?`, { cause }), { digest: statusDigest(503) });
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
  tenant: { id: string; name: string; nameAm: string | null; doctorsCanRegister?: boolean; offlineMode?: boolean };
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
  /** Worked out from an age, not a known birth date. */
  dobEstimated?: boolean;
  phone: string | null;
  /** Other address details or a landmark, besides the structured address. */
  address: string | null;
  region?: string | null;
  zone?: string | null;
  woreda?: string | null;
  kebele?: string | null;
  houseNo?: string | null;
  /** Fayda number, digits only. */
  nationalId?: string | null;
  nextOfKinName?: string | null;
  nextOfKinRelation?: string | null;
  nextOfKinPhone?: string | null;
  familyId: string | null;
  /** Set on a duplicate merged into another record. */
  mergedIntoId?: string | null;
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
  /** Where the patient was referred from, if anyone. */
  referredFrom?: string | null;
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
  /** Triage priority: RED (emergency), ORANGE, YELLOW, GREEN (routine); the queue is in this order. */
  triageLevel?: "RED" | "ORANGE" | "YELLOW" | "GREEN" | null;
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
  /** Triaged red: sampled before payment. */
  emergency?: boolean;
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

/** The headline numbers of the period before the one shown, for the comparison. */
export interface PeriodTotals {
  from: string;
  to: string;
  visits: number;
  completed: number;
  newPatients: number;
  collected: string;
  billed: string;
  avgWaitMinutes: number | null;
  unbilled: string;
  /** Per day of that period, oldest first: lines up day for day with the period shown. */
  daily: { visits: number[]; collected: string[] };
}

/** Today, right now (only when the period runs to today). */
export interface RightNow {
  at: string;
  waiting: number;
  inConsultation: number;
  awaitingLab: number;
  awaitingPharmacy: number;
  longestWaitMinutes: number | null;
  samplesToTake: number;
  resultsToVerify: number;
  prescriptionsToDispense: number;
  visitsToBill: number;
}

export interface Dashboard {
  from: string;
  to: string;
  previous?: PeriodTotals;
  now?: RightNow | null;
  patients: {
    visits: number;
    completed: number;
    seen?: number;
    newPatients: number;
    avgWaitMinutes: number | null;
    medianWaitMinutes?: number | null;
    p90WaitMinutes?: number | null;
    /** Waits under 15 min, 15–30, 30–60, 1–2 h, over 2 h. */
    waitBands?: number[];
    /** Check-ins by weekday (Monday first) and hour of the day. */
    arrivals?: number[][];
    bySexAge?: { ageGroup: string; male: number; female: number }[];
    byDoctor: { name: string; count: number }[];
    cancelled?: number;
    cancelledByReason?: Record<string, number>;
  };
  revenue: {
    collected: string;
    byMethod: Partial<Record<PaymentMethod, string>>;
    billed: string;
    discounts: string;
    unbilled: string;
    unbilledCount: number;
    /** What each department delivered in the period, at the price charged. */
    bySource?: { source: "CONSULTATION" | "LAB" | "PHARMACY" | "PROCEDURE" | "OTHER"; amount: string }[];
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
  daily: { day: string; visits: number; collected: string; newPatients?: number; billed?: string; avgWaitMinutes?: number | null }[];
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
    referralsOut: number;
    referralsIn?: number;
  };
  morbidity: { code: string; label: string; male: number; female: number; total: number }[];
  malaria: { tested: number; positive: number; byResult: { result: string; count: number }[] };
  anc?: {
    contacts: number;
    firstContacts: number;
    firstBy12Weeks: number;
    firstBefore16Weeks: number;
    fourthContacts: number;
    eighthContacts: number;
    syphilisTested: number;
    syphilisPositive: number;
    hivTested: number;
    hivPositive: number;
    hbsagTested: number;
    anaemic: number;
    ifaGiven: number;
  };
  familyPlanning?: {
    acceptorsNew: number;
    acceptorsRepeat: number;
    byMethod: { method: string; label: string; new: number; repeat: number }[];
    byAge: { ageGroup: string; new: number; repeat: number }[];
    removals: number;
    earlyRemovals: number;
    removalsByMethod: { method: string; label: string; count: number }[];
    cyp: number;
  };
  immunization?: {
    doses: { vaccine: string; doseNo: number; label: string; under1: number; over1: number }[];
    fullyImmunized: number;
    dropOut: { penta1ToPenta3: number | null; penta1ToMeasles1: number | null };
  };
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
  offlineMode?: boolean; // staff PCs keep the day's work for the offline workspace
}

/** A condition kept on the patient's record across visits. */
export interface PatientProblem {
  id: string;
  icd11Code: string | null;
  label: string;
  status: "ACTIVE" | "RESOLVED";
  since: string | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** One visit's vitals, for the trend. */
export interface VitalsRow {
  id: string;
  checkedInAt: string;
  systolicBp: number | null;
  diastolicBp: number | null;
  pulse: number | null;
  temperatureC: string | null;
  spo2: number | null;
  weightKg: string | null;
  heightCm: string | null;
  muacMm: number | null;
}

export interface VisitNotifiable {
  key: string;
  label: string;
  labelAm: string;
  immediate: boolean;
  notification: { reportedAt: string; reportedTo: string; note: string | null; reportedBy: string | null } | null;
}

export type ReferralStatus = "SENT" | "ARRIVED" | "FEEDBACK_RECEIVED" | "DID_NOT_GO";

export interface ReferralFollowUp {
  id: string;
  status: ReferralStatus;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface ReferralRow {
  id: string;
  createdAt: string;
  visit: { id: string; checkedInAt: string; patient: QueuePatient };
  to: string;
  urgency: "ROUTINE" | "URGENT" | "EMERGENCY";
  reason: string;
  issuedBy: string | null;
  status: ReferralStatus;
  ageDays: number;
  overdue: boolean;
  followUps: ReferralFollowUp[];
}

type IdsrPatient = QueuePatient & { address: string | null; region?: string | null; zone?: string | null; woreda?: string | null; kebele?: string | null; houseNo?: string | null };

export interface IdsrReport {
  facility: { name: string; nameAm: string | null; address: string | null; phone: string | null };
  week: { year: number; week: number; start: string; end: string; inProgress: boolean };
  diseases: { key: string; label: string; labelAm: string; immediate: boolean; under5: number; over5: number; unknownAge: number; total: number }[];
  malaria: { tested: number; positive: number; falciparum: number; vivax: number; mixed: number; notStated: number };
  immediateCases: {
    visitId: string;
    checkedInAt: string;
    patient: IdsrPatient;
    disease: string;
    label: string;
    notification: { reportedAt: string; reportedTo: string; note: string | null; reportedBy: string | null } | null;
  }[];
  unreported: { visitId: string; checkedInAt: string; patient: IdsrPatient; disease: string; label: string }[];
  unreportedDays: number;
}

export type TestResult = "NEGATIVE" | "POSITIVE" | "NOT_DONE";

export interface AncContact {
  id: string;
  contactNo: number;
  contactOn: string;
  gaWeeks: number;
  gaDays: number;
  weightKg: string | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  fundalHeightCm: number | null;
  fetalHeartRate: number | null;
  presentation: string | null;
  urineProtein: string | null;
  hb: string | null;
  syphilis: TestResult | null;
  hiv: TestResult | null;
  hbsag: TestResult | null;
  dangerSigns: string[];
  ifaTablets: number | null;
  dewormed: boolean;
  note: string | null;
  nextContactOn: string;
  by: string | null;
  alerts: { level: "URGENT" | "WARNING"; text: string }[];
  /** Recorded by mistake: shown, marked, but counts for nothing. */
  voidedAt?: string | null;
  voidReason?: string | null;
  voidedBy?: string | null;
}

/** A pregnancy followed in antenatal care. */
export interface Pregnancy {
  id: string;
  lmp: string;
  edd: string;
  eddSource: "LMP" | "ULTRASOUND";
  gravida: number;
  para: number;
  riskFactors: string[];
  risks: { key: string; label: string }[];
  bloodGroup: string | null;
  status: "ACTIVE" | "DELIVERED" | "ENDED";
  outcome: string | null;
  endedOn: string | null;
  gestation: { weeks: number; days: number } | null;
  nextContactOn: string | null;
  late: boolean;
  /** About the pregnancy as a whole: Rh-negative, a Td dose due. */
  alerts?: { level: "URGENT" | "WARNING"; text: string }[];
  contacts: AncContact[];
}

/** A woman in antenatal care due, late, or near her due date. */
export interface AncDueRow {
  pregnancyId: string;
  patient: QueuePatient;
  gestation: { weeks: number; days: number };
  edd: string;
  contacts: number;
  nextContactOn: string;
  daysLate: number;
  late: boolean;
  dueThisWeek: boolean;
  deliverySoon: boolean;
}

export type DoseStatus = "GIVEN" | "UPCOMING" | "DUE" | "OVERDUE" | "MISSED";

export interface ImmunizationDoseRecord {
  id: string;
  vaccine: string;
  doseNo: number;
  label: string;
  givenOn: string;
  lotNo: string | null;
  site: string | null;
  elsewhere: boolean;
  facility: string | null;
  note: string | null;
  givenBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
}

export interface ScheduledDose {
  vaccine: string;
  doseNo: number;
  label: string;
  milestone: string;
  status: DoseStatus;
  dueOn: string;
  notBefore: string;
  waitingFor: string | null;
  given: { id: string; givenOn: string } | null;
}

/** A patient's immunization record: schedule, every dose recorded, follow-up calls. */
export interface ImmunizationRecord {
  dobKnown: boolean;
  dobEstimated: boolean;
  schedule: ScheduledDose[];
  doses: ImmunizationDoseRecord[];
  followUps: { id: string; outcome: string; note: string | null; createdAt: string; by: string | null }[];
  aefis?: Aefi[];
}

/** One family planning service: a method started, resupplied, removed or stopped. */
export interface FpRecordRow {
  id: string;
  givenOn: string;
  service: "START" | "RESUPPLY" | "REMOVAL" | "STOP";
  method: string;
  clientType: "NEW" | "REPEAT" | null;
  quantity: number | null;
  nextDueOn: string | null;
  reason: string | null;
  note: string | null;
  by: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
}

/** A client's family planning: her records, current method and when she is next due. */
export interface FpView {
  records: FpRecordRow[];
  current: { method: string; since: string; nextDueOn: string | null; device: boolean; late: boolean; removalDue: boolean } | null;
  servedBefore: boolean;
}

/** A client due back: a resupply due or late, or a device due out. */
export interface FpDueRow {
  patient: QueuePatient;
  method: string;
  nextDueOn: string;
  removal: boolean;
  late: boolean;
  daysLate: number;
}

/** An adverse event following immunization. */
export interface Aefi {
  id: string;
  patientId: string;
  doseId: string | null;
  doseLabel: string | null;
  onsetOn: string;
  signs: string[];
  serious: boolean;
  outcome: string;
  reportedTo: string | null;
  reportedOn: string | null;
  note: string | null;
  by?: string | null;
  createdAt: string;
  /** Serious and not yet reported to the woreda. */
  reportPending?: boolean;
  patient?: QueuePatient;
}

/** A child due or late for a vaccine. */
export interface DueChild {
  patient: QueuePatient;
  defaulter: boolean;
  daysLate: number;
  doses: { label: string; status: DoseStatus; dueOn: string }[];
  lastFollowUp: { outcome: string; note: string | null; at: string; by: string | null } | null;
}

export interface VisitAddendum {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; fullName: string | null; role: Role } | null;
}

/** What the patient takes home from a consultation. */
export interface VisitSummary {
  id: string;
  checkedInAt: string;
  patientAdvice: string | null;
  patient: QueuePatient;
  doctor: { fullName: string } | null;
  tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null };
  diagnoses: { icd11Code: string; label: string; isPrimary: boolean }[];
  medicines: { dose: string; frequency: Frequency; durationDays: number | null; quantity: number; instructions: string | null; drug: { genericName: string; strength: string | null; form: string; unit: string } }[];
  labOrders: { status: string; resultValue: string | null; resultFlag: string | null; labTest: { name: string; unit: string | null } }[];
  nextAppointment: { scheduledAt: string; reason: string | null; doctor: { fullName: string } | null } | null;
}

export interface Diagnosis {
  id: string;
  icd11Code: string;
  label: string;
  isPrimary: boolean;
}

export const VITAL_FIELDS = ["temperatureC", "pulse", "systolicBp", "diastolicBp", "respRate", "spo2", "weightKg", "heightCm", "muacMm"] as const;
export const NOTE_FIELDS = ["chiefComplaint", "history", "examination", "plan", "patientAdvice"] as const;
export type VitalField = (typeof VITAL_FIELDS)[number];
export type NoteField = (typeof NOTE_FIELDS)[number];

/** Decimal vitals arrive from the API as strings ("38.6"); integer ones as numbers. */
export type VisitDetail = QueueVisit &
  Record<VitalField, string | number | null> &
  Record<NoteField, string | null> & {
    kind: "OPD" | "WALK_IN" | "LAB";
    /** Pregnancy (women who could be pregnant): with the first day of the last period. */
    pregnancyStatus?: "NOT_PREGNANT" | "POSSIBLE" | "PREGNANT" | null;
    lmpDate?: string | null;
    breastfeeding?: boolean | null;
    prepayment: boolean;
    consultationPaid: boolean;
    owed: string; // all unpaid charges of the visit
    diagnoses: Diagnosis[];
    /** Notes added afterwards: signed, timed, never edited. */
    addenda?: VisitAddendum[];
    /** Diseases public health must hear about; immediate ones are reported from the visit. */
    notifiable?: VisitNotifiable[];
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

export type ReminderOutcome = "CONFIRMED" | "NO_ANSWER" | "CANNOT_COME" | "WRONG_NUMBER";
export type TraceOutcome = "REBOOKED" | "WILL_COME" | "NO_ANSWER" | "WRONG_NUMBER" | "DECLINED";

/** Tomorrow's (or a day's) booked appointments to phone. */
export interface ReminderList {
  day: string;
  appointments: (Appointment & { reminderSentAt: string | null; reminderOutcome: ReminderOutcome | null; reminderBy: string | null })[];
}

/** A missed appointment to follow up. */
export interface MissedAppointment {
  id: string;
  scheduledAt: string;
  reason: string | null;
  patient: QueuePatient;
  doctor: { id: string; fullName: string } | null;
  problems: string[];
  lastVisitAt: string | null;
  traceOutcome: TraceOutcome | null;
  traceNote: string | null;
  tracedAt: string | null;
  tracedBy: string | null;
}

/** Bookings per day and doctor (null: any doctor). */
export type BookingLoad = { day: string; doctorId: string | null; count: number }[];

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
  /** Where it came from: the computer's address and browser (none on entries from before they were kept). */
  ip?: string | null;
  userAgent?: string | null;
  category?: AuditCategory;
  /** An action a reviewer should see first (voids, reversals, failed sign-ins, exports…). */
  sensitive?: boolean;
  /** What it is about, in words, with a link. */
  target?: { label: string; href?: string } | null;
  /** The start of the entry's seal (none on entries from before the log was sealed). */
  seal?: string | null;
}

/** One page of the audit log, with the period at a glance. */
export interface AuditPage {
  from: string;
  to: string;
  patient: { id: string; name: string; mrn: string } | null;
  entries: AuditEntry[];
  next: string | null;
  matching: number;
  summary: {
    total: number;
    byCategory: Record<string, number>;
    sensitive: number;
    failedSignIns: number;
    recordViews: number;
    exports: number;
    people: number;
  };
  seal: string | null;
}

/** The result of checking the audit log's seal. */
export interface AuditIntegrity {
  checkedAt: string;
  sealed: number;
  unsealed: number;
  altered: number;
  missing: number;
  intact: boolean;
  alteredEntries: { id: string; action: string; createdAt: string }[];
  seal: string | null;
}

export interface ClinicalDocument {
  id: string;
  type: "MEDICAL_CERTIFICATE" | "REFERRAL";
  data: Record<string, string | number>;
  createdAt: string;
  /** Issued with a mistake: kept, marked void, and issued again. */
  voidedAt?: string | null;
  voidReason?: string | null;
  /** Referrals only: where it stands, from its follow-ups. */
  referralStatus?: ReferralStatus | null;
  followUps?: ReferralFollowUp[];
}

export interface ClinicalDocumentDetail extends ClinicalDocument {
  visit: {
    id: string;
    checkedInAt: string;
    patient: QueuePatient;
    tenant: { name: string; nameAm: string | null; phone: string | null; address: string | null };
    diagnoses: { icd11Code: string; label: string; isPrimary: boolean }[];
    // The visit's vital signs and released results, for the referral letter.
    temperatureC?: string | null;
    pulse?: number | null;
    systolicBp?: number | null;
    diastolicBp?: number | null;
    respRate?: number | null;
    spo2?: number | null;
    weightKg?: string | null;
    muacMm?: number | null;
    labOrders?: { resultValue: string | null; resultFlag: string | null; rangeText: string | null; verifiedAt: string | null; labTest: { name: string; unit: string | null } }[];
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
  /** "continuous": the HMIS backup service on the server; "nightly": one encrypted copy a night to a bucket (app hosting). */
  mode: "continuous" | "nightly";
  retention: { days: number | null; months: number | null } | null;
  overall: BackupCheckStatus;
  /** Not monitored, but the host backs the database up itself (HMIS_BACKUPS_MANAGED_BY). */
  managedBy: string | null;
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

/** One report from the library (lib/reports.ts names its columns). */
export type ReportCell = string | number | null;
export interface ReportResult {
  rows: Record<string, ReportCell>[];
  totals?: Record<string, ReportCell>;
  /** More rows than a report returns: narrow the period. */
  truncated?: boolean;
  /** As of now (stock, money owed), not for a period. */
  asOfNow?: boolean;
}

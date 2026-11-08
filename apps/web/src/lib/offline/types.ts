import type {
  DrugOption,
  IcdEntry,
  LabOrder,
  LabWorkOrder,
  Me,
  Patient,
  PendingBill,
  PharmacyPrescription,
  Prescription,
  QueueVisit,
  Service,
  VisitDetail,
  VisitStatus,
} from "@/lib/api";

/** Lab tests as the catalogue lists them (for ordering offline). */
export type OfflineLabTest = { id: string; name: string; price: string; unit: string | null; resultOptions: string[]; components?: { id: string }[] };

/**
 * What one signed-in user needs to keep working offline, saved in this browser. Refreshed every
 * few minutes while online; replaced when someone else signs in on this PC.
 */
export interface Snapshot {
  /** Server time when the download started: work the server applied before this is included. */
  at: string;
  /** When the sign-in this was downloaded with expires: after that the workspace locks. */
  validUntil: string | null;
  /** A read-only cloud copy of a clinic that works on its own clinic server: no offline work. */
  readOnly: boolean;
  me: Me;
  prepayment: boolean;
  queue: QueueVisit[];
  patients: Patient[];
  services: Service[];
  labTests: OfflineLabTest[];
  drugs: DrugOption[];
  icd: IcdEntry[];
  /** Doctors: their open visits in full (notes, tests and prescriptions so far). */
  visits: Record<string, VisitDetail & { labOrders?: LabOrder[]; prescriptions?: Prescription[] }>;
  lab: LabWorkOrder[];
  pharmacy: PharmacyPrescription[];
  /** What each visit still owes (charges not invoiced plus open invoice balances). */
  bills: (PendingBill & { paid?: string })[];
}

/** One HTTP call of an operation. `$0.id` in a path is replaced by step 0's reply's id. */
export interface Step {
  method: "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export type OpKind =
  | "register"
  | "checkin"
  | "status"
  | "notes"
  | "diagnosis"
  | "lab-order"
  | "prescribe"
  | "pay"
  | "collect"
  | "result"
  | "verify"
  | "bill-drugs"
  | "dispense";

/**
 * Work done offline, waiting to be sent. Temporary ids ("tmp_…") stand for records the server
 * has not created yet; once the creating operation is sent, the real id replaces them everywhere.
 */
export interface Op {
  id: string; // also the base of the Idempotency-Key, so a resend is applied once
  userId: string;
  at: string; // when it was done, by this PC's clock (shown to people; not used for ordering)
  /** Order of sending: this browser's own counter, not the clock. */
  seq?: number;
  /** Bumped when a person re-sends work whose outcome was unknown: a new Idempotency-Key. */
  attempt?: number;
  kind: OpKind;
  label: string; // shown in the list: "Register Abebe Kebede"
  steps: Step[];
  /** Temporary ids this operation creates: tmp ← the reply of steps[step] at `pick`. */
  creates?: { tmp: string; step: number; pick: string }[];
  /** What the screen needs to show the effect before the server has it. */
  data: Record<string, unknown>;
  status: "pending" | "done" | "failed";
  error?: string;
  /** The server's details for a refusal (e.g. possible duplicate patients, prescribing alerts). */
  errorBody?: unknown;
  errorCode?: string;
  /** When the server applied it, by the server's clock (compared with Snapshot.at). */
  doneAt?: string;
}

export const isTmp = (id: unknown): id is string => typeof id === "string" && id.startsWith("tmp_");
export const tmpId = () => `tmp_${crypto.randomUUID()}`;

export type { VisitStatus };

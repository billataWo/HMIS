import { CANCEL_REASONS } from "@/lib/cancel-reasons";

/**
 * The report library's catalog: what each report is called, what it is for, its columns and its
 * filters. The API (apps/api/src/reports/library.ts) returns the rows by column key; the page and
 * the CSV are both made from these definitions, so they always match.
 */

export type ReportCategory = "money" | "clinical" | "pharmacy" | "operations" | "submissions";

export const CATEGORIES: { key: ReportCategory; title: string; description: string }[] = [
  { key: "money", title: "Money", description: "Payments, invoices, discounts and who owes the clinic" },
  { key: "clinical", title: "Clinical", description: "Registers of visits, diagnoses, lab tests and referrals" },
  { key: "pharmacy", title: "Pharmacy and stock", description: "Stock on hand, expiry, dispensing and losses" },
  { key: "operations", title: "Operations", description: "Staff activity, appointments and cancelled visits" },
  { key: "submissions", title: "MoH and records", description: "Reports sent to the health office, and the clinic's own records" },
];

type Choice = { value: string; label: string };
export type ColumnType = "text" | "mono" | "number" | "money" | "datetime" | "date" | "minutes" | "age" | "days" | "choice";
export interface ReportColumn {
  key: string;
  label: string;
  type?: ColumnType;
  /** For `choice`: what each stored value is called. */
  choices?: readonly Choice[];
  /** Long text: allowed to wrap. */
  wrap?: boolean;
  /** Any value above zero is bad news (expired stock, debt over 90 days): shown in red. */
  alert?: boolean;
}
export interface ReportFilter {
  name: "method" | "status" | "doctorId" | "days";
  label: string;
  /** Fixed options; `doctorId` lists the clinic's doctors instead. */
  options?: readonly Choice[];
  /** The value used when none is chosen (shown as selected). */
  initial?: string;
  /** Label of the "no filter" option ("All"); none means a value is always chosen. */
  any?: string;
}
export interface ReportDef {
  key: string;
  category: ReportCategory;
  title: string;
  description: string;
  columns: ReportColumn[];
  filters?: ReportFilter[];
  /** As of now, not for a period: no dates to choose. */
  asOfNow?: boolean;
}
/** A report that lives on its own page (the MoH forms, cash closing, registers kept elsewhere). */
export interface ReportLink {
  href: string;
  category: ReportCategory;
  title: string;
  description: string;
}

const METHODS: Choice[] = [
  { value: "CASH", label: "Cash" },
  { value: "TELEBIRR", label: "Telebirr" },
  { value: "CHAPA", label: "Chapa" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
];
const PAYMENT_KINDS: Choice[] = [
  { value: "PAYMENT", label: "Payment" },
  { value: "PAYER", label: "Paid by insurer or company" },
  { value: "REFUND", label: "Refund" },
  { value: "REVERSAL", label: "Reversal" },
];
const INVOICE_STATUSES: Choice[] = [
  { value: "OPEN", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
];
const SOURCES: Choice[] = [
  { value: "CONSULTATION", label: "Consultation" },
  { value: "LAB", label: "Lab" },
  { value: "PHARMACY", label: "Pharmacy" },
  { value: "PROCEDURE", label: "Procedures" },
  { value: "OTHER", label: "Other" },
];
const DISCOUNTS: Choice[] = [
  { value: "STAFF", label: "Staff or their family" },
  { value: "POOR", label: "Cannot pay (fee waiver)" },
  { value: "FOLLOW_UP", label: "Free follow-up" },
  { value: "PROGRAMME", label: "Free programme service (TB, HIV, family planning…)" },
  { value: "GOODWILL", label: "Goodwill" },
  { value: "OTHER", label: "Other" },
  { value: "UNCATEGORISED", label: "Not categorised (before categories)" },
];
const DEBTORS: Choice[] = [
  { value: "PATIENT", label: "Patient" },
  { value: "CREDIT", label: "Credit company" },
  { value: "INSURANCE", label: "Insurer" },
];
const SEXES: Choice[] = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
];
const VISIT_TYPES: Choice[] = [
  { value: "NEW", label: "New" },
  { value: "REPEAT", label: "Repeat" },
];
const VISIT_STATUSES: Choice[] = [
  { value: "WAITING", label: "Waiting" },
  { value: "IN_CONSULTATION", label: "With doctor" },
  { value: "AWAITING_LAB", label: "At lab" },
  { value: "AWAITING_PHARMACY", label: "At pharmacy" },
  { value: "COMPLETED", label: "Done" },
];
const LAB_STATUSES: Choice[] = [
  { value: "ORDERED", label: "Ordered" },
  { value: "SAMPLE_COLLECTED", label: "Sample taken" },
  { value: "RESULTED", label: "Waiting for checking" },
  { value: "VERIFIED", label: "Released" },
  { value: "CANCELLED", label: "Cancelled" },
];
const FLAGS: Choice[] = [
  { value: "H", label: "High" },
  { value: "L", label: "Low" },
  { value: "HH", label: "Critical high" },
  { value: "LL", label: "Critical low" },
];
const URGENCY: Choice[] = [
  { value: "ROUTINE", label: "Routine" },
  { value: "URGENT", label: "Urgent" },
  { value: "EMERGENCY", label: "Emergency" },
];
const REFERRAL_STATUSES: Choice[] = [
  { value: "SENT", label: "Sent" },
  { value: "ARRIVED", label: "Arrived" },
  { value: "FEEDBACK_RECEIVED", label: "Feedback received" },
  { value: "DID_NOT_GO", label: "Did not go" },
];
const STOCK_STATUSES: Choice[] = [
  { value: "OK", label: "In stock" },
  { value: "LOW", label: "Low" },
  { value: "OUT", label: "Out of stock" },
];
const LOSS_TYPES: Choice[] = [
  { value: "EXPIRED", label: "Expired" },
  { value: "ADJUSTMENT", label: "Damaged, lost or corrected" },
];
const ROLES: Choice[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "RECEPTIONIST", label: "Receptionist" },
  { value: "DOCTOR", label: "Doctor" },
  { value: "NURSE", label: "Nurse" },
  { value: "CASHIER", label: "Cashier" },
  { value: "PHARMACIST", label: "Pharmacist" },
  { value: "LAB_TECH", label: "Lab technician" },
];
const APPOINTMENT_STATUSES: Choice[] = [
  { value: "BOOKED", label: "Booked" },
  { value: "ARRIVED", label: "Came" },
  { value: "NO_SHOW", label: "Did not come" },
  { value: "CANCELLED", label: "Cancelled" },
];
const CANCELLED: Choice[] = [...CANCEL_REASONS, { value: "NOT_GIVEN", label: "No reason given" }];

const patient: ReportColumn[] = [
  { key: "mrn", label: "MRN", type: "mono" },
  { key: "patient", label: "Patient" },
];

export const REPORTS: ReportDef[] = [
  // ── Money ──
  {
    key: "payments",
    category: "money",
    title: "Payments received",
    description: "Every payment, refund and reversal, with its invoice, method, reference and cashier.",
    filters: [
      { name: "method", label: "Method", options: METHODS, any: "All methods" },
      { name: "status", label: "Show", options: [{ value: "REFUNDS", label: "Refunds and reversals only" }], any: "Everything" },
    ],
    columns: [
      { key: "at", label: "Received", type: "datetime" },
      { key: "invoice", label: "Invoice", type: "mono" },
      ...patient,
      { key: "kind", label: "Type", type: "choice", choices: PAYMENT_KINDS },
      { key: "method", label: "Method", type: "choice", choices: METHODS },
      { key: "reference", label: "Reference or note", wrap: true },
      { key: "cashier", label: "Cashier" },
      { key: "amount", label: "Amount", type: "money" },
    ],
  },
  {
    key: "revenue-by-service",
    category: "money",
    title: "Revenue by service",
    description: "What each service brought in over the period: delivered, billed and not yet billed.",
    columns: [
      { key: "source", label: "Department", type: "choice", choices: SOURCES },
      { key: "service", label: "Service", wrap: true },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "amount", label: "Delivered", type: "money" },
      { key: "billed", label: "Billed", type: "money" },
      { key: "notBilled", label: "Not billed", type: "money" },
    ],
  },
  {
    key: "invoices",
    category: "money",
    title: "Invoice register",
    description: "Every invoice raised, who pays it, the discount, what was paid and what is left.",
    filters: [{ name: "status", label: "Status", options: INVOICE_STATUSES, any: "All invoices" }],
    columns: [
      { key: "at", label: "Date", type: "datetime" },
      { key: "invoice", label: "Invoice", type: "mono" },
      ...patient,
      { key: "payer", label: "Insurer or company" },
      { key: "status", label: "Status", type: "choice", choices: INVOICE_STATUSES },
      { key: "total", label: "Total", type: "money" },
      { key: "discount", label: "Discount", type: "money" },
      { key: "paid", label: "Paid", type: "money" },
      { key: "balance", label: "Balance", type: "money" },
    ],
  },
  {
    key: "discounts",
    category: "money",
    title: "Discounts and exemptions",
    description: "Each discount or exemption given, why, and who gave it: what an auditor asks for first.",
    columns: [
      { key: "at", label: "Date", type: "datetime" },
      { key: "invoice", label: "Invoice", type: "mono" },
      ...patient,
      { key: "category", label: "Category", type: "choice", choices: DISCOUNTS },
      { key: "reason", label: "Reason", wrap: true },
      { key: "subtotal", label: "Before discount", type: "money" },
      { key: "discount", label: "Discount", type: "money" },
      { key: "by", label: "Given by" },
    ],
  },
  {
    key: "debtors",
    category: "money",
    title: "Who owes the clinic",
    description: "Every patient, credit company and insurer with money owed today, by how old the debt is.",
    asOfNow: true,
    columns: [
      { key: "debtor", label: "Owed by" },
      { key: "kind", label: "Type", type: "choice", choices: DEBTORS },
      { key: "mrn", label: "MRN", type: "mono" },
      { key: "phone", label: "Phone", type: "mono" },
      { key: "invoices", label: "Invoices", type: "number" },
      { key: "oldest", label: "Oldest", type: "date" },
      { key: "d0", label: "0–30 days", type: "money" },
      { key: "d31", label: "31–60", type: "money" },
      { key: "d61", label: "61–90", type: "money" },
      { key: "d90", label: "Over 90", type: "money", alert: true },
      { key: "owed", label: "Total owed", type: "money" },
    ],
  },

  // ── Clinical ──
  {
    key: "opd-register",
    category: "clinical",
    title: "OPD register",
    description: "Every outpatient visit: new or repeat, age and sex, the doctor and the main diagnosis.",
    filters: [{ name: "doctorId", label: "Doctor", any: "All doctors" }],
    columns: [
      { key: "at", label: "Checked in", type: "datetime" },
      { key: "queue", label: "No.", type: "number" },
      ...patient,
      { key: "sex", label: "Sex", type: "choice", choices: SEXES },
      { key: "age", label: "Age", type: "age" },
      { key: "visitType", label: "Visit", type: "choice", choices: VISIT_TYPES },
      { key: "referredFrom", label: "Referred from" },
      { key: "doctor", label: "Doctor" },
      { key: "diagnosis", label: "Main diagnosis", wrap: true },
      { key: "status", label: "Status", type: "choice", choices: VISIT_STATUSES },
    ],
  },
  {
    key: "morbidity",
    category: "clinical",
    title: "Diagnoses by age and sex",
    description: "Cases of each diagnosis (ICD-11) by sex and age group: every diagnosis recorded on a visit.",
    columns: [
      { key: "code", label: "ICD-11", type: "mono" },
      { key: "diagnosis", label: "Diagnosis", wrap: true },
      { key: "male", label: "Male", type: "number" },
      { key: "female", label: "Female", type: "number" },
      { key: "age:<1", label: "Under 1", type: "number" },
      { key: "age:1-4", label: "1–4", type: "number" },
      { key: "age:5-14", label: "5–14", type: "number" },
      { key: "age:15-29", label: "15–29", type: "number" },
      { key: "age:30-64", label: "30–64", type: "number" },
      { key: "age:65+", label: "65+", type: "number" },
      { key: "age:unknown", label: "Age not known", type: "number" },
      { key: "total", label: "Total", type: "number" },
    ],
  },
  {
    key: "lab-register",
    category: "clinical",
    title: "Lab register",
    description: "Every test ordered: the result and flag, who released it, and the time from sample to result.",
    filters: [{ name: "status", label: "Status", options: LAB_STATUSES, any: "All but cancelled" }],
    columns: [
      { key: "at", label: "Ordered", type: "datetime" },
      ...patient,
      { key: "test", label: "Test" },
      { key: "urgent", label: "Urgent", type: "choice", choices: [{ value: "URGENT", label: "Urgent" }] },
      { key: "result", label: "Result", wrap: true },
      { key: "flag", label: "Flag", type: "choice", choices: FLAGS },
      { key: "status", label: "Status", type: "choice", choices: LAB_STATUSES },
      { key: "sentTo", label: "Sent to" },
      { key: "verifiedBy", label: "Released by" },
      { key: "tat", label: "Sample to result", type: "minutes" },
    ],
  },
  {
    key: "referrals",
    category: "clinical",
    title: "Referrals out",
    description: "Patients referred to other facilities, how urgently, and whether they got there.",
    columns: [
      { key: "at", label: "Referred", type: "datetime" },
      ...patient,
      { key: "to", label: "Referred to" },
      { key: "urgency", label: "Urgency", type: "choice", choices: URGENCY },
      { key: "reason", label: "Reason", wrap: true },
      { key: "status", label: "Follow-up", type: "choice", choices: REFERRAL_STATUSES },
    ],
  },

  // ── Pharmacy and stock ──
  {
    key: "stock-on-hand",
    category: "pharmacy",
    title: "Stock on hand",
    description: "Every drug on the list today: what is on the shelf, its value at cost, and what to reorder.",
    asOfNow: true,
    columns: [
      { key: "drug", label: "Drug", wrap: true },
      { key: "form", label: "Form" },
      { key: "onHand", label: "On hand", type: "number" },
      { key: "unit", label: "Unit" },
      { key: "reorderLevel", label: "Reorder at", type: "number" },
      { key: "status", label: "Status", type: "choice", choices: STOCK_STATUSES },
      { key: "nearestExpiry", label: "Next expiry", type: "date" },
      { key: "expired", label: "Expired on shelf", type: "number", alert: true },
      { key: "value", label: "Value (cost)", type: "money" },
    ],
  },
  {
    key: "expiry",
    category: "pharmacy",
    title: "Expiry report",
    description: "Batches on the shelf that have expired or will soon, oldest first, with their value.",
    asOfNow: true,
    filters: [
      {
        name: "days",
        label: "Expiring within",
        initial: "90",
        options: [
          { value: "0", label: "Already expired" },
          { value: "30", label: "30 days" },
          { value: "90", label: "90 days" },
          { value: "180", label: "180 days" },
          { value: "365", label: "1 year" },
        ],
      },
    ],
    columns: [
      { key: "drug", label: "Drug", wrap: true },
      { key: "batch", label: "Batch", type: "mono" },
      { key: "store", label: "Store" },
      { key: "expiry", label: "Expiry", type: "date" },
      { key: "daysLeft", label: "Days left", type: "days" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "unit", label: "Unit" },
      { key: "value", label: "Value (cost)", type: "money" },
    ],
  },
  {
    key: "dispensing",
    category: "pharmacy",
    title: "Drugs dispensed",
    description: "What the pharmacy gave out per drug, less returns, at cost and at selling price.",
    columns: [
      { key: "drug", label: "Drug", wrap: true },
      { key: "units", label: "Units", type: "number" },
      { key: "unit", label: "Unit" },
      { key: "cost", label: "Cost", type: "money" },
      { key: "value", label: "At selling price", type: "money" },
      { key: "margin", label: "Margin", type: "money" },
    ],
  },
  {
    key: "stock-losses",
    category: "pharmacy",
    title: "Stock losses",
    description: "Stock written off as expired, damaged, lost or corrected down, with who did it and why.",
    columns: [
      { key: "at", label: "Date", type: "datetime" },
      { key: "drug", label: "Drug", wrap: true },
      { key: "batch", label: "Batch", type: "mono" },
      { key: "type", label: "Type", type: "choice", choices: LOSS_TYPES },
      { key: "reason", label: "Reason", wrap: true },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "unit", label: "Unit" },
      { key: "value", label: "Value (cost)", type: "money" },
      { key: "by", label: "By" },
    ],
  },

  // ── Operations ──
  {
    key: "staff-activity",
    category: "operations",
    title: "Staff activity",
    description: "What each member of staff did: patients seen, samples, results, dispensing and payments.",
    columns: [
      { key: "name", label: "Name" },
      { key: "role", label: "Role", type: "choice", choices: ROLES },
      { key: "active", label: "Account", type: "choice", choices: [{ value: "INACTIVE", label: "Turned off" }] },
      { key: "patientsSeen", label: "Patients seen", type: "number" },
      { key: "samplesTaken", label: "Samples taken", type: "number" },
      { key: "resultsVerified", label: "Results released", type: "number" },
      { key: "itemsDispensed", label: "Items dispensed", type: "number" },
      { key: "paymentsTaken", label: "Payments taken", type: "number" },
      { key: "collected", label: "Collected", type: "money" },
    ],
  },
  {
    key: "appointments",
    category: "operations",
    title: "Appointments",
    description: "Appointments booked for the period and whether the patient came.",
    filters: [
      { name: "status", label: "Status", options: APPOINTMENT_STATUSES, any: "All appointments" },
      { name: "doctorId", label: "Doctor", any: "All doctors" },
    ],
    columns: [
      { key: "at", label: "Booked for", type: "datetime" },
      ...patient,
      { key: "phone", label: "Phone", type: "mono" },
      { key: "doctor", label: "Doctor" },
      { key: "reason", label: "Reason", wrap: true },
      { key: "status", label: "Status", type: "choice", choices: APPOINTMENT_STATUSES },
    ],
  },
  {
    key: "cancelled-visits",
    category: "operations",
    title: "Cancelled visits",
    description: "Visits cancelled and why, with the patient's phone to call back those who left without being seen.",
    columns: [
      { key: "at", label: "Checked in", type: "datetime" },
      { key: "queue", label: "No.", type: "number" },
      ...patient,
      { key: "phone", label: "Phone", type: "mono" },
      { key: "reason", label: "Reason", type: "choice", choices: CANCELLED },
    ],
  },
];

export const REPORT_LINKS: ReportLink[] = [
  { href: "/billing/daily", category: "money", title: "Daily cash closing", description: "Each cashier's takings for a day against the cash counted, by method." },
  { href: "/inventory/controlled", category: "pharmacy", title: "Controlled drugs register", description: "Every movement of narcotic and psychotropic drugs, with running balances." },
  { href: "/lab/qc", category: "clinical", title: "Lab quality control", description: "Control runs, Westgard rule breaks and the Levey-Jennings charts." },
  { href: "/reports/idsr", category: "submissions", title: "Weekly IDSR report", description: "Notifiable diseases for the woreda health office, week by week." },
  { href: "/reports/moh", category: "submissions", title: "Monthly MoH report", description: "OPD by age and sex, top diseases, immunization, ANC, family planning and malaria." },
  { href: "/audit", category: "submissions", title: "Audit log", description: "Who did what and when: sign-ins, changes, exports and removals." },
];

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key);

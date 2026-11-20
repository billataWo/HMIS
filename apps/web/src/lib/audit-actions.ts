/**
 * What each audit action is called in the audit log ("invoice.void" → "Voided an invoice"). The
 * API groups them (apps/api/src/audit/catalog.ts); an action missing here is shown by its code.
 */

export type AuditCategory = "security" | "access" | "money" | "clinical" | "records" | "stock" | "settings";

export const AUDIT_CATEGORIES: { key: AuditCategory; label: string; description: string }[] = [
  { key: "security", label: "Security", description: "Sign-ins, failed sign-ins, staff accounts and permissions" },
  { key: "access", label: "Record access", description: "Patient records opened, and data downloaded or printed" },
  { key: "money", label: "Money", description: "Invoices, payments, refunds and cash closing" },
  { key: "clinical", label: "Clinical", description: "Visits, diagnoses, lab, prescriptions and programmes" },
  { key: "records", label: "Patients", description: "Registrations, changes, merges and appointments" },
  { key: "stock", label: "Stock", description: "Drugs, deliveries, counts, adjustments and write-offs" },
  { key: "settings", label: "Settings", description: "Prices, lab tests, screens and clinic settings" },
];

export const AUDIT_ACTIONS: { code: string; label: string }[] = [
  // Security
  { code: "auth.login", label: "Signed in" },
  { code: "auth.login_failed", label: "Failed to sign in (wrong password)" },
  { code: "auth.locked", label: "Sign-in locked after repeated failures" },
  { code: "auth.two_step_failed", label: "Entered a wrong two-step code" },
  { code: "auth.temporary_password_expired", label: "Tried an expired temporary password" },
  { code: "user.create", label: "Added a staff account" },
  { code: "user.update", label: "Changed a staff account" },
  { code: "user.password", label: "Changed their password" },
  { code: "user.admin_reset", label: "Reset a staff member's password" },
  { code: "user.two_step_enabled", label: "Turned on two-step sign-in" },
  { code: "user.two_step_disabled", label: "Turned off two-step sign-in" },
  { code: "user.two_step_codes", label: "Made new recovery codes" },
  { code: "licence.installed", label: "Installed a licence" },
  { code: "clinic.created", label: "Clinic created" },
  // Record access
  { code: "patient.viewed", label: "Opened a patient's record" },
  { code: "visit.viewed", label: "Opened a visit" },
  { code: "visit.copied_offline", label: "Copied a visit to a PC for offline work" },
  { code: "offline.patients_copied", label: "Copied the patient list to a PC for offline work" },
  { code: "patient.exported", label: "Downloaded a patient's record" },
  { code: "clinic.exported", label: "Downloaded all the clinic's data" },
  { code: "report.exported", label: "Downloaded a report" },
  { code: "audit.exported", label: "Downloaded the audit log" },
  { code: "receipt.print", label: "Printed a receipt" },
  // Money
  { code: "invoice.create", label: "Raised an invoice" },
  { code: "invoice.remove-line", label: "Removed a line from an invoice" },
  { code: "invoice.void", label: "Voided an invoice" },
  { code: "payment.create", label: "Took a payment" },
  { code: "payment.reverse", label: "Reversed a payment" },
  { code: "payment.online", label: "Received an online payment" },
  { code: "payment.online_unapplied", label: "Online payment not matched to a bill" },
  { code: "payer.create", label: "Added an insurer or credit company" },
  { code: "payer.update", label: "Changed an insurer or credit company" },
  { code: "payer.tariff", label: "Changed an insurer's prices" },
  { code: "payer.settlement", label: "Recorded a payment from an insurer or company" },
  { code: "coverage.update", label: "Changed a patient's insurance or credit" },
  { code: "cash.close", label: "Closed the cash for the day" },
  { code: "pharmacy.walk-in", label: "Made a counter sale" },
  { code: "subscription.checkout", label: "Started paying for the subscription online" },
  { code: "subscription.payment_reported", label: "Reported a subscription payment" },
  // Patients
  { code: "patient.create", label: "Registered a patient" },
  { code: "patient.update", label: "Changed a patient's details" },
  { code: "patient.merge", label: "Merged two patient records" },
  { code: "appointment.book", label: "Booked an appointment" },
  { code: "appointment.move", label: "Moved an appointment" },
  { code: "appointment.status", label: "Changed an appointment" },
  { code: "appointment.reminder", label: "Called a patient about an appointment" },
  { code: "appointment.trace", label: "Traced a patient who missed an appointment" },
  // Clinical
  { code: "visit.checkin", label: "Checked a patient in" },
  { code: "visit.status", label: "Moved a visit on" },
  { code: "visit.update", label: "Recorded vitals or notes" },
  { code: "visit.transfer", label: "Moved a patient to another doctor" },
  { code: "visit.coverage", label: "Changed who pays for a visit" },
  { code: "visit.summary", label: "Wrote the visit summary" },
  { code: "visit.addendum", label: "Added an addendum" },
  { code: "diagnosis.add", label: "Added a diagnosis" },
  { code: "diagnosis.remove", label: "Removed a diagnosis" },
  { code: "problem.add", label: "Added to the problem list" },
  { code: "problem.update", label: "Changed the problem list" },
  { code: "procedure.add", label: "Added a procedure" },
  { code: "procedure.remove", label: "Removed a procedure" },
  { code: "document.issue", label: "Issued a certificate or referral" },
  { code: "document.void", label: "Voided a certificate or referral" },
  { code: "referral.follow-up", label: "Recorded a referral follow-up" },
  { code: "idsr.notify", label: "Reported a notifiable disease" },
  { code: "lab.order", label: "Ordered lab tests" },
  { code: "lab.walk-in", label: "Registered a lab-only visit" },
  { code: "lab.collect", label: "Took a sample" },
  { code: "lab.reject", label: "Rejected a sample" },
  { code: "lab.send", label: "Sent a sample to another lab" },
  { code: "lab.unsend", label: "Took back a sent-out sample" },
  { code: "lab.urgent", label: "Marked a test urgent" },
  { code: "lab.verify", label: "Released a result" },
  { code: "lab.amend", label: "Amended a released result" },
  { code: "lab.cancel", label: "Cancelled a lab test" },
  { code: "lab.alert-seen", label: "Saw a critical result alert" },
  { code: "prescription.create", label: "Wrote a prescription" },
  { code: "prescription.bill", label: "Billed a prescription" },
  { code: "prescription.dispense", label: "Dispensed a prescription" },
  { code: "prescription.substitute", label: "Gave a different brand or drug" },
  { code: "prescription.return", label: "Took back returned drugs" },
  { code: "prescription.close", label: "Closed a prescription" },
  { code: "prescription.cancel", label: "Cancelled a prescription" },
  { code: "immunization.give", label: "Gave a vaccine" },
  { code: "immunization.void", label: "Voided a vaccine dose" },
  { code: "immunization.follow-up", label: "Recorded a vaccination follow-up call" },
  { code: "immunization.aefi", label: "Reported a vaccine side effect" },
  { code: "immunization.aefi-update", label: "Updated a vaccine side-effect report" },
  { code: "anc.register", label: "Started antenatal care" },
  { code: "anc.update", label: "Changed a pregnancy record" },
  { code: "anc.contact", label: "Recorded an antenatal visit" },
  { code: "anc.contact-void", label: "Voided an antenatal visit" },
  { code: "anc.end", label: "Closed a pregnancy record" },
  { code: "fp.give", label: "Gave a family planning method" },
  { code: "fp.stop", label: "Recorded stopping family planning" },
  { code: "fp.removal", label: "Removed an implant or IUCD" },
  { code: "fp.void", label: "Voided a family planning record" },
  // Stock
  { code: "stock.receive", label: "Received stock" },
  { code: "stock.adjust", label: "Adjusted stock" },
  { code: "stock.writeoff", label: "Wrote off expired stock" },
  { code: "stock.count", label: "Recorded a stock count" },
  { code: "stock.transfer", label: "Moved stock between stores" },
  { code: "po.create", label: "Made a purchase order" },
  { code: "po.update", label: "Changed a purchase order" },
  { code: "po.order", label: "Sent a purchase order" },
  { code: "po.cancel", label: "Cancelled a purchase order" },
  { code: "drug.create", label: "Added a drug" },
  { code: "drug.update", label: "Changed a drug" },
  { code: "drug.import", label: "Imported a drug list" },
  { code: "supplier.create", label: "Added a supplier" },
  { code: "supplier.update", label: "Changed a supplier" },
  { code: "store.create", label: "Added a store" },
  { code: "store.update", label: "Changed a store" },
  { code: "lab.reagent", label: "Changed a reagent" },
  { code: "lab.reagent-receive", label: "Received reagent stock" },
  { code: "lab.reagent-adjust", label: "Adjusted reagent stock" },
  { code: "lab.reagent-uses", label: "Changed reagent use per test" },
  // Settings
  { code: "settings.update", label: "Changed clinic settings" },
  { code: "service.create", label: "Added a service price" },
  { code: "service.update", label: "Changed a service price" },
  { code: "labtest.create", label: "Added a lab test" },
  { code: "labtest.update", label: "Changed a lab test" },
  { code: "labtest.ranges", label: "Changed a lab test's normal ranges" },
  { code: "labtest.recommended-ranges", label: "Applied recommended normal ranges" },
  { code: "lab.qc", label: "Recorded a quality-control run" },
  { code: "lab.qc-control", label: "Changed a quality-control material" },
  { code: "lab.qc-action", label: "Recorded a quality-control action" },
  { code: "display.create", label: "Added a waiting-room screen" },
  { code: "display.paired", label: "Paired a waiting-room screen" },
  { code: "display.repair", label: "Paired a waiting-room screen again" },
  { code: "display.revoke", label: "Removed a waiting-room screen" },
];

const BY_ACTION = new Map(AUDIT_ACTIONS.map((a) => [a.code, a.label]));

/** The action's name in words (English key), or null for one HMIS has no name for yet. */
export const actionLabel = (action: string) => BY_ACTION.get(action) ?? null;

/** "Chrome on Windows", "Safari on iPhone": enough to recognise a computer, not a fingerprint. */
export function deviceOf(userAgent: string | null | undefined) {
  if (!userAgent) return null;
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /node|undici|curl|HMIS/i.test(ua)
              ? "HMIS server"
              : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  return [browser, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

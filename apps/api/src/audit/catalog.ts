/**
 * How audit actions are grouped and which ones deserve a second look. The web app names each
 * action (lib/audit-actions.ts); here the API needs only the group, to filter and count.
 */

export const AUDIT_CATEGORIES = ['security', 'access', 'money', 'clinical', 'records', 'stock', 'settings'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

const BY_PREFIX: [string, AuditCategory][] = [
  ['auth.', 'security'],
  ['user.', 'security'],
  ['licence.', 'security'],
  ['invoice.', 'money'],
  ['payment.', 'money'],
  ['payer.', 'money'],
  ['cash.', 'money'],
  ['receipt.', 'money'],
  ['subscription.', 'money'],
  ['coverage.', 'money'],
  ['pharmacy.', 'money'],
  ['patient.', 'records'],
  ['appointment.', 'records'],
  ['stock.', 'stock'],
  ['po.', 'stock'],
  ['drug.', 'stock'],
  ['supplier.', 'stock'],
  ['store.', 'stock'],
  ['lab.reagent', 'stock'],
  ['settings.', 'settings'],
  ['service.', 'settings'],
  ['labtest.', 'settings'],
  ['display.', 'settings'],
  ['lab.qc', 'settings'],
];

/** The group of an action: looking at or taking away records first, then by its prefix. */
export function categoryOf(action: string): AuditCategory {
  if (action.endsWith('.viewed') || action.endsWith('.exported') || action.endsWith('_copied') || action.endsWith('.copied_offline') || action === 'receipt.print') return 'access';
  return BY_PREFIX.find(([p]) => action.startsWith(p))?.[1] ?? 'clinical';
}

/**
 * Actions a reviewer should see first: failed and locked sign-ins, account and permission
 * changes, money taken back, records merged, amended or voided, data taken out of HMIS, stock
 * written off, prices and settings changed.
 */
export const SENSITIVE = new Set([
  'auth.login_failed',
  'auth.locked',
  'auth.two_step_failed',
  'auth.temporary_password_expired',
  'user.create',
  'user.update',
  'user.admin_reset',
  'user.two_step_disabled',
  'licence.installed',
  'invoice.void',
  'payment.reverse',
  'invoice.remove-line',
  'prescription.return',
  'payer.tariff',
  'payer.settlement',
  'patient.merge',
  'patient.exported',
  'clinic.exported',
  'report.exported',
  'audit.exported',
  'lab.amend',
  'lab.cancel',
  'prescription.substitute',
  'prescription.cancel',
  'document.void',
  'immunization.void',
  'fp.void',
  'anc.contact-void',
  'diagnosis.remove',
  'procedure.remove',
  'stock.adjust',
  'stock.writeoff',
  'stock.count',
  'settings.update',
  'service.update',
]);

/** The actions of a group, among those recorded (a group is its prefixes plus the special cases). */
export function actionsIn(category: AuditCategory, recorded: string[]) {
  return recorded.filter((a) => categoryOf(a) === category);
}

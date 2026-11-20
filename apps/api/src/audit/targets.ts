import type { PrismaService } from '../prisma/prisma.service.js';

type Db = PrismaService['client'];
export type Target = { label: string; href?: string };

const nameOf = (p: { firstName: string; fatherName: string }) => `${p.firstName} ${p.fatherName}`;
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Addis_Ababa' });
const patient = { select: { firstName: true, fatherName: true, mrn: true } } as const;

/**
 * What each entry is about, in words, with a link to it: "Almaz Tesfaye (MRN-000123)", "Invoice
 * INV-0042 · Almaz Tesfaye". Looked up for one page of entries at a time, one query per kind.
 */
export async function resolveTargets(db: Db, tenantId: string, entries: { entity: string; entityId: string | null }[]) {
  const ids = (entity: string) => [...new Set(entries.filter((e) => e.entity === entity && e.entityId).map((e) => e.entityId!))];
  const out = new Map<string, Target>();
  const put = (entity: string, id: string, t: Target) => out.set(`${entity}:${id}`, t);
  const t = tenantId;

  await Promise.all([
    ids('Patient').length &&
      db.patient.findMany({ where: { tenantId: t, id: { in: ids('Patient') } }, select: { id: true, firstName: true, fatherName: true, mrn: true } }).then((rows) => {
        for (const p of rows) put('Patient', p.id, { label: `${nameOf(p)} (${p.mrn})`, href: `/patients/${p.id}` });
      }),
    ids('Visit').length &&
      db.visit.findMany({ where: { tenantId: t, id: { in: ids('Visit') } }, select: { id: true, checkedInAt: true, patient } }).then((rows) => {
        for (const v of rows) put('Visit', v.id, { label: `${nameOf(v.patient)} (${v.patient.mrn}) · ${day(v.checkedInAt)}`, href: `/visits/${v.id}` });
      }),
    ids('Invoice').length &&
      db.invoice.findMany({ where: { tenantId: t, id: { in: ids('Invoice') } }, select: { id: true, number: true, patient } }).then((rows) => {
        for (const i of rows) put('Invoice', i.id, { label: `${i.number} · ${nameOf(i.patient)}`, href: `/billing/invoices/${i.id}` });
      }),
    ids('LabOrder').length &&
      db.labOrder.findMany({ where: { tenantId: t, id: { in: ids('LabOrder') } }, select: { id: true, visitId: true, labTest: { select: { name: true } }, visit: { select: { patient } } } }).then((rows) => {
        for (const o of rows) put('LabOrder', o.id, { label: `${o.labTest.name} · ${nameOf(o.visit.patient)}`, href: `/visits/${o.visitId}` });
      }),
    ids('Prescription').length &&
      db.prescription.findMany({ where: { tenantId: t, id: { in: ids('Prescription') } }, select: { id: true, visitId: true, visit: { select: { patient } } } }).then((rows) => {
        for (const p of rows) put('Prescription', p.id, { label: `${nameOf(p.visit.patient)} (${p.visit.patient.mrn})`, href: `/visits/${p.visitId}` });
      }),
    ids('ClinicalDocument').length &&
      db.clinicalDocument.findMany({ where: { tenantId: t, id: { in: ids('ClinicalDocument') } }, select: { id: true, visitId: true, visit: { select: { patient } } } }).then((rows) => {
        for (const d of rows) put('ClinicalDocument', d.id, { label: `${nameOf(d.visit.patient)} (${d.visit.patient.mrn})`, href: `/visits/${d.visitId}` });
      }),
    ids('User').length &&
      db.user.findMany({ where: { tenantId: t, id: { in: ids('User') } }, select: { id: true, fullName: true } }).then((rows) => {
        for (const u of rows) put('User', u.id, { label: u.fullName, href: '/users' });
      }),
    ids('Drug').length &&
      db.drug.findMany({ where: { tenantId: t, id: { in: ids('Drug') } }, select: { id: true, genericName: true, strength: true } }).then((rows) => {
        for (const d of rows) put('Drug', d.id, { label: [d.genericName, d.strength].filter(Boolean).join(' '), href: `/inventory/drugs/${d.id}` });
      }),
    ids('StockBatch').length &&
      db.stockBatch.findMany({ where: { id: { in: ids('StockBatch') }, drug: { tenantId: t } }, select: { id: true, batchNo: true, drug: { select: { id: true, genericName: true } } } }).then((rows) => {
        for (const b of rows) put('StockBatch', b.id, { label: `${b.drug.genericName} · ${b.batchNo}`, href: `/inventory/drugs/${b.drug.id}` });
      }),
    ids('Payer').length &&
      db.payer.findMany({ where: { tenantId: t, id: { in: ids('Payer') } }, select: { id: true, name: true } }).then((rows) => {
        for (const p of rows) put('Payer', p.id, { label: p.name, href: `/billing/payers/${p.id}` });
      }),
    ids('PurchaseOrder').length &&
      db.purchaseOrder.findMany({ where: { tenantId: t, id: { in: ids('PurchaseOrder') } }, select: { id: true, number: true } }).then((rows) => {
        for (const p of rows) put('PurchaseOrder', p.id, { label: p.number, href: `/inventory/orders/${p.id}` });
      }),
    ids('Supplier').length &&
      db.supplier.findMany({ where: { tenantId: t, id: { in: ids('Supplier') } }, select: { id: true, name: true } }).then((rows) => {
        for (const s of rows) put('Supplier', s.id, { label: s.name, href: '/inventory/suppliers' });
      }),
    ids('LabTest').length &&
      db.labTest.findMany({ where: { tenantId: t, id: { in: ids('LabTest') } }, select: { id: true, name: true } }).then((rows) => {
        for (const l of rows) put('LabTest', l.id, { label: l.name, href: '/settings/prices' });
      }),
    ids('ServiceItem').length &&
      db.serviceItem.findMany({ where: { tenantId: t, id: { in: ids('ServiceItem') } }, select: { id: true, name: true } }).then((rows) => {
        for (const s of rows) put('ServiceItem', s.id, { label: s.name, href: '/settings/prices' });
      }),
  ]);
  for (const e of entries) {
    if (e.entity === 'Report' && e.entityId) put('Report', e.entityId, { label: e.entityId, href: `/reports/${e.entityId}` });
  }
  return (entity: string, id: string | null) => (id ? (out.get(`${entity}:${id}`) ?? null) : null);
}

/** Every record id that belongs to a patient: the audit entries about them are about one of these. */
export async function patientScope(db: Db, tenantId: string, patientId: string) {
  const [visits, invoices] = await Promise.all([
    db.visit.findMany({
      where: { tenantId, patientId },
      select: { id: true, labOrders: { select: { id: true } }, prescriptions: { select: { id: true } }, documents: { select: { id: true } } },
    }),
    db.invoice.findMany({ where: { tenantId, patientId }, select: { id: true } }),
  ]);
  return [
    patientId,
    ...visits.flatMap((v) => [v.id, ...v.labOrders.map((o) => o.id), ...v.prescriptions.map((p) => p.id), ...v.documents.map((d) => d.id)]),
    ...invoices.map((i) => i.id),
  ];
}

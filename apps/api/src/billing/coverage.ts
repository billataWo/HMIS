import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { chargeTerms } from '../common/settlement.js';

type Tx = Prisma.TransactionClient;

/**
 * A patient's active coverages, offered at check-in (with their end date: the API refuses an
 * expired one, and the form says so).
 */
export const usableCoverages = () =>
  ({
    where: { active: true, payer: { active: true } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      memberId: true,
      validUntil: true,
      payer: { select: { id: true, name: true, type: true, coPayPercent: true, requiresAuthorization: true } },
    },
  }) satisfies Prisma.Patient$coveragesArgs;

/**
 * The visit's billing terms from one of the patient's coverages: the payer, the member number, the
 * co-payment (copied, so a later change to the agreement doesn't alter this visit) and the
 * authorization number, which some payers require for every visit.
 */
export async function visitCoverage(tx: Tx, tenantId: string, patientId: string, coverageId: string, authorizationNo?: string | null) {
  const c = await tx.patientCoverage.findFirst({ where: { id: coverageId, tenantId, patientId }, include: { payer: true } });
  if (!c) throw new NotFoundException("That coverage is not on this patient's record");
  if (!c.active || !c.payer.active) throw new ConflictException(`The coverage with ${c.payer.name} is no longer active`);
  if (c.validUntil && c.validUntil < new Date()) throw new ConflictException(`The coverage with ${c.payer.name} ended on ${c.validUntil.toISOString().slice(0, 10)}`);
  if (c.payer.requiresAuthorization && !authorizationNo) {
    throw new ConflictException({ message: `${c.payer.name} needs an authorization number for each visit`, code: 'AUTHORIZATION_REQUIRED' });
  }
  return { payerId: c.payerId, memberId: c.memberId, coPayPercent: c.payer.coPayPercent, authorizationNo: authorizationNo || null, payer: c.payer };
}

/** The catalogue item a charge is for, and its price at the clinic, so the charge can be re-priced. */
async function itemOf(tx: Tx, c: { source: string; sourceId: string | null }) {
  if (!c.sourceId) return null;
  if (c.source === 'CONSULTATION' || c.source === 'PROCEDURE') {
    const s = await tx.serviceItem.findUnique({ where: { id: c.sourceId }, select: { id: true, price: true } });
    return s && { type: 'SERVICE' as const, id: s.id, price: s.price };
  }
  if (c.source === 'LAB') {
    const o = await tx.labOrder.findUnique({ where: { id: c.sourceId }, select: { labTest: { select: { id: true, price: true } } } });
    return o && { type: 'LAB' as const, id: o.labTest.id, price: o.labTest.price };
  }
  if (c.source === 'PHARMACY') {
    const i = await tx.prescriptionItem.findUnique({ where: { id: c.sourceId }, select: { drug: { select: { id: true, sellPrice: true } } } });
    return i && { type: 'DRUG' as const, id: i.drug.id, price: i.drug.sellPrice };
  }
  return null;
}

/**
 * After the visit's payer changes: the charges not invoiced yet are priced again, at the new payer's
 * tariff (or the clinic's price for a patient paying themselves).
 */
export async function repriceVisit(tx: Tx, visitId: string, payerId: string | null) {
  const charges = await tx.charge.findMany({ where: { visitId, invoiceId: null, voidedAt: null } });
  for (const c of charges) {
    const item = await itemOf(tx, c);
    if (!item) {
      await tx.charge.update({ where: { id: c.id }, data: { payerId: null } });
      continue;
    }
    const terms = await chargeTerms(tx, { payerId }, item.type, item.id, item.price);
    await tx.charge.update({ where: { id: c.id }, data: terms });
  }
  return charges.length;
}

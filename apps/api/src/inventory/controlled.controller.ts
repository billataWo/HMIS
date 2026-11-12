import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RegisterSchema = z.object({
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
  drugId: z.uuid().optional(),
});

const DAY = 86_400_000;

/**
 * The controlled-drug register: for each narcotic and psychotropic drug, every unit received,
 * dispensed, returned, adjusted or written off in the period, with the balance after each line.
 *
 * It is built from the stock movements, which the database keeps as a permanent record (they can't
 * be changed or deleted), so the register can't drift from the stock. The closing balance is the
 * physical stock (all batches, expired ones included) less what moved after the period; the
 * opening balance is the closing balance less what moved in it.
 */
@Controller('controlled-register')
@Roles('ADMIN', 'PHARMACIST')
export class ControlledRegisterController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async register(@CurrentUser() me: AuthUser, @Query(new ZodPipe(RegisterSchema)) q: z.infer<typeof RegisterSchema>) {
    const today = clinicDay();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 8)}01`; // the month so far
    const start = dayRange(from).start;
    const end = dayRange(to).end;
    if (start >= end) throw new BadRequestException('The start date must be on or before the end date');
    if (end.getTime() - start.getTime() > 367 * DAY) throw new BadRequestException('Choose a period of a year or less');

    const db = this.prisma.client;
    const drugs = await db.drug.findMany({
      where: { tenantId: me.tenantId, controlled: { not: null }, ...(q.drugId && { id: q.drugId }) },
      orderBy: [{ controlled: 'asc' }, { genericName: 'asc' }],
      include: { batches: { select: { id: true, quantity: true } } },
    });
    if (!drugs.length) return { from, to, drugs: [] };

    const batchIds = drugs.flatMap((d) => d.batches.map((b) => b.id));
    const [moves, later] = await Promise.all([
      db.stockMovement.findMany({
        where: { batchId: { in: batchIds }, createdAt: { gte: start, lt: end } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { batch: { select: { drugId: true, batchNo: true, expiryDate: true, receiptRef: true, supplierRef: { select: { name: true } }, supplier: true } } },
      }),
      db.stockMovement.groupBy({ by: ['batchId'], where: { batchId: { in: batchIds }, createdAt: { gte: end } }, _sum: { quantity: true } }),
    ]);

    // Who: staff names; and for dispensing and returns, the patient and the prescriber.
    const userIds = [...new Set(moves.map((m) => m.userId).filter((u): u is string => !!u))];
    const itemIds = [...new Set(moves.filter((m) => (m.type === 'DISPENSE' || m.type === 'RETURN') && m.reference).map((m) => m.reference!))];
    const [users, items] = await Promise.all([
      userIds.length ? db.user.findMany({ where: { tenantId: me.tenantId, id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
      itemIds.length
        ? db.prescriptionItem.findMany({
            where: { id: { in: itemIds }, prescription: { tenantId: me.tenantId } },
            select: {
              id: true,
              prescription: {
                select: {
                  id: true,
                  prescriber: { select: { fullName: true } },
                  visit: { select: { kind: true, patient: { select: { id: true, mrn: true, firstName: true, fatherName: true, grandfather: true } } } },
                },
              },
            },
          })
        : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    const itemOf = new Map(items.map((i) => [i.id, i.prescription]));
    const laterByBatch = new Map(later.map((l) => [l.batchId, l._sum.quantity ?? 0]));

    return {
      from,
      to,
      drugs: drugs.map((d) => {
        const onHand = d.batches.reduce((s, b) => s + b.quantity, 0);
        const closing = onHand - d.batches.reduce((s, b) => s + (laterByBatch.get(b.id) ?? 0), 0);
        const mine = moves.filter((m) => m.batch.drugId === d.id);
        const opening = closing - mine.reduce((s, m) => s + m.quantity, 0);
        let balance = opening;
        const lines = mine.map((m) => {
          balance += m.quantity;
          const rx = m.reference ? itemOf.get(m.reference) : undefined;
          return {
            id: m.id,
            at: m.createdAt,
            type: m.type,
            batchNo: m.batch.batchNo,
            expiryDate: m.batch.expiryDate,
            in: m.quantity > 0 ? m.quantity : 0,
            out: m.quantity < 0 ? -m.quantity : 0,
            balance,
            by: m.userId ? (userName.get(m.userId) ?? null) : null,
            supplier: m.type === 'RECEIPT' ? (m.batch.supplierRef?.name ?? m.batch.supplier ?? null) : null,
            reference: m.type === 'RECEIPT' ? m.reference ?? m.batch.receiptRef : null,
            reason: m.reason,
            patient: rx?.visit.patient ?? null,
            prescriber: rx && rx.visit.kind !== 'WALK_IN' ? rx.prescriber.fullName : null,
            prescriptionId: rx?.id ?? null,
          };
        });
        return {
          id: d.id,
          genericName: d.genericName,
          brandName: d.brandName,
          strength: d.strength,
          form: d.form,
          unit: d.unit,
          controlled: d.controlled,
          opening,
          received: lines.reduce((s, l) => s + l.in, 0),
          issued: lines.reduce((s, l) => s + l.out, 0),
          closing,
          lines,
        };
      }),
    };
  }
}

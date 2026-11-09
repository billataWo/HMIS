import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequiresFeature } from '../platform/subscription.guard.js';
import { queuePatientSelect } from '../visits/visits.controller.js';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .optional();

const PayerSchema = z.object({
  type: z.enum(['CREDIT', 'INSURANCE']),
  name: z.string().trim().min(2).max(200),
  phone: optional(50),
  contactPerson: optional(200),
});
const PayerUpdateSchema = PayerSchema.partial().extend({ active: z.boolean().optional() });

const StatementSchema = z.object({
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
});

const SettlementSchema = z
  .object({
    method: z.enum(['CASH', 'TELEBIRR', 'CHAPA', 'BANK_TRANSFER']),
    amount: z.number().positive().max(100_000_000),
    reference: z
      .string()
      .trim()
      .max(100)
      .transform((s) => s || undefined)
      .optional(),
  })
  .refine((p) => p.method === 'CASH' || !!p.reference, { message: 'Enter the transaction or cheque reference', path: ['reference'] });

const OPEN = ['OPEN', 'PARTIALLY_PAID'] as const;

/**
 * Credit companies and insurers: their account (what they owe), a statement to send them, and
 * settlement of many invoices with one payment, oldest first.
 */
@Controller('payers')
@Roles('ADMIN', 'CASHIER')
export class PayersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async payer(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Payer not found');
    const payer = await this.prisma.client.payer.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!payer) throw new NotFoundException('Payer not found');
    return payer;
  }

  @Get()
  async list(@CurrentUser() me: AuthUser) {
    const [payers, open] = await Promise.all([
      this.prisma.client.payer.findMany({ where: { tenantId: me.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      this.prisma.client.invoice.findMany({ where: { tenantId: me.tenantId, payerId: { not: null }, status: { in: [...OPEN] } }, select: { payerId: true, total: true, paid: true } }),
    ]);
    const due = new Map<string, { amount: number; count: number }>();
    for (const i of open) {
      const d = due.get(i.payerId!) ?? { amount: 0, count: 0 };
      d.amount += toCents(i.total) - toCents(i.paid);
      d.count += 1;
      due.set(i.payerId!, d);
    }
    return payers.map((p) => ({ ...p, balance: fromCents(due.get(p.id)?.amount ?? 0), openInvoices: due.get(p.id)?.count ?? 0 }));
  }

  @Post()
  @RequiresFeature('CREDIT')
  @Roles('ADMIN')
  async create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(PayerSchema)) body: z.infer<typeof PayerSchema>) {
    const exists = await this.prisma.client.payer.findFirst({ where: { tenantId: me.tenantId, name: { equals: body.name, mode: 'insensitive' } } });
    if (exists) throw new ConflictException('A payer with this name already exists');
    const payer = await this.prisma.client.payer.create({ data: { ...body, tenantId: me.tenantId } });
    await this.audit.log(me, 'payer.create', 'Payer', payer.id, { name: payer.name, type: payer.type });
    return payer;
  }

  @Patch(':id')
  @RequiresFeature('CREDIT')
  @Roles('ADMIN')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(PayerUpdateSchema)) body: z.infer<typeof PayerUpdateSchema>) {
    await this.payer(me, id);
    const payer = await this.prisma.client.payer.update({ where: { id }, data: body });
    await this.audit.log(me, 'payer.update', 'Payer', id, { fields: Object.keys(body) });
    return payer;
  }

  /** Invoices billed to the payer in a period (default: this month), and everything still unpaid. */
  @Get(':id/statement')
  async statement(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query(new ZodPipe(StatementSchema)) q: z.infer<typeof StatementSchema>) {
    const payer = await this.payer(me, id);
    const today = clinicDay();
    const from = q.from ?? `${today.slice(0, 8)}01`;
    const to = q.to ?? today;
    const select = {
      id: true,
      number: true,
      createdAt: true,
      status: true,
      total: true,
      paid: true,
      patient: { select: queuePatientSelect },
      charges: { where: { voidedAt: null }, select: { description: true, quantity: true, unitPrice: true } },
    } as const;
    const [inPeriod, unpaid, tenant] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { tenantId: me.tenantId, payerId: id, status: { not: 'VOID' }, createdAt: { gte: dayRange(from).start, lt: dayRange(to).end } },
        orderBy: { createdAt: 'asc' },
        select,
      }),
      this.prisma.client.invoice.findMany({ where: { tenantId: me.tenantId, payerId: id, status: { in: [...OPEN] } }, orderBy: { createdAt: 'asc' }, select }),
      this.prisma.client.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { name: true, nameAm: true, phone: true, address: true } }),
    ]);
    const sum = (list: { total: { toString(): string }; paid: { toString(): string } }[], f: (t: number, p: number) => number) =>
      fromCents(list.reduce((s, i) => s + f(toCents(i.total), toCents(i.paid)), 0));
    const withBalance = <T extends { total: { toString(): string }; paid: { toString(): string } }>(i: T) => ({ ...i, balance: fromCents(toCents(i.total) - toCents(i.paid)) });
    return {
      payer,
      tenant,
      from,
      to,
      invoices: inPeriod.map(withBalance),
      billed: sum(inPeriod, (t) => t),
      unpaid: unpaid.map(withBalance),
      balance: sum(unpaid, (t, p) => t - p),
    };
  }

  /** One payment from the payer, applied to its unpaid invoices oldest first. */
  @Post(':id/settlements')
  async settle(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(SettlementSchema)) body: z.infer<typeof SettlementSchema>) {
    const payer = await this.payer(me, id);
    return this.prisma.client.$transaction(async (tx) => {
      const closed = await tx.cashClosing.findFirst({ where: { tenantId: me.tenantId, cashierId: me.sub, day: new Date(clinicDay()) } });
      if (closed) throw new ConflictException("You have already closed today's cash; ask another cashier or an admin");
      if (body.reference) {
        const dup = await tx.payment.findFirst({ where: { tenantId: me.tenantId, method: body.method, reference: body.reference } });
        if (dup) throw new ConflictException('This transaction reference has already been recorded');
      }
      // Lock the payer's open invoices so a payment at the counter can't race this settlement.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Invoice" WHERE "tenantId" = ${me.tenantId} AND "payerId" = ${id} AND "status" IN ('OPEN', 'PARTIALLY_PAID')
        ORDER BY "createdAt" ASC FOR UPDATE`;
      const invoices = await tx.invoice.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
      const owed = invoices.reduce((s, i) => s + toCents(i.total) - toCents(i.paid), 0);
      let left = toCents(body.amount);
      if (left > owed) throw new ConflictException(`${payer.name} owes ${fromCents(owed)} ETB; the payment is more than that`);

      const applied: { number: string; amount: string }[] = [];
      for (const inv of invoices) {
        if (left === 0) break;
        const due = toCents(inv.total) - toCents(inv.paid);
        const take = Math.min(due, left);
        await tx.payment.create({
          data: {
            tenantId: me.tenantId,
            invoiceId: inv.id,
            cashierId: me.sub,
            method: body.method,
            amount: fromCents(take),
            reference: body.reference,
            note: `Settlement from ${payer.name}`,
          },
        });
        const paid = toCents(inv.paid) + take;
        await tx.invoice.update({ where: { id: inv.id }, data: { paid: fromCents(paid), status: paid >= toCents(inv.total) ? 'PAID' : 'PARTIALLY_PAID' } });
        applied.push({ number: inv.number, amount: fromCents(take) });
        left -= take;
      }
      await this.audit.log(me, 'payer.settlement', 'Payer', id, { amount: fromCents(toCents(body.amount)), method: body.method, invoices: applied.length }, tx);
      return { applied, remainingBalance: fromCents(owed - toCents(body.amount)) };
    });
  }
}

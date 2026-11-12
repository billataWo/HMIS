import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { fromCents, toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequiresFeature } from '../platform/subscription.guard.js';

const Lines = z
  .array(
    z.object({
      drugId: z.uuid(),
      quantity: z.number().int().min(1).max(1_000_000),
      unitCost: z.number().min(0).max(1_000_000).nullable().optional(),
    }),
  )
  .min(1, 'Add at least one drug')
  .max(100)
  .refine((ls) => new Set(ls.map((l) => l.drugId)).size === ls.length, 'Each drug may appear only once');

const CreateSchema = z.object({ supplierId: z.uuid(), note: z.string().trim().max(500).optional(), lines: Lines });
const UpdateSchema = z.object({ note: z.string().trim().max(500).optional(), lines: Lines.optional() });
const ListSchema = z.object({ status: z.enum(['DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional() });

const include = {
  supplier: { select: { id: true, name: true, phone: true, contactPerson: true, tin: true } },
  lines: { include: { drug: { select: { id: true, genericName: true, strength: true, form: true, unit: true, sellPrice: true, packSize: true, packName: true } } } },
} satisfies Prisma.PurchaseOrderInclude;

type WithLines = { lines: { quantity: number; unitCost: { toString(): string } | null }[] };
const withTotal = <T extends WithLines>(po: T) => ({
  ...po,
  total: fromCents(po.lines.reduce((s, l) => s + (l.unitCost === null ? 0 : toCents(l.unitCost) * l.quantity), 0)),
});

/**
 * Purchase orders to suppliers: drafted, marked as ordered (printed and sent), then filled by
 * deliveries received against them (Inventory → Receive stock, choosing the order).
 */
@Controller('purchase-orders')
@Roles('ADMIN', 'PHARMACIST')
@RequiresFeature('PURCHASE_ORDERS')
export class PurchaseOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async find(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Purchase order not found');
    const po = await this.prisma.client.purchaseOrder.findFirst({ where: { id, tenantId: me.tenantId }, include });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  private async checkDrugs(me: AuthUser, lines: z.infer<typeof Lines>) {
    const found = await this.prisma.client.drug.count({ where: { tenantId: me.tenantId, id: { in: lines.map((l) => l.drugId) } } });
    if (found !== lines.length) throw new NotFoundException('One or more drugs were not found');
  }

  @Get()
  async list(@CurrentUser() me: AuthUser, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    const pos = await this.prisma.client.purchaseOrder.findMany({
      where: { tenantId: me.tenantId, ...(q.status && { status: q.status }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include,
    });
    return pos.map(withTotal);
  }

  @Get(':id')
  async get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const [po, tenant] = await Promise.all([
      this.find(me, id),
      this.prisma.client.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { name: true, nameAm: true, phone: true, address: true } }),
    ]);
    return { ...withTotal(po), tenant };
  }

  @Post()
  async create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>) {
    const supplier = await this.prisma.client.supplier.findFirst({ where: { id: body.supplierId, tenantId: me.tenantId, active: true } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    await this.checkDrugs(me, body.lines);
    const po = await this.prisma.client.$transaction(async (tx) => {
      const { nextPo } = await tx.tenant.update({ where: { id: me.tenantId }, data: { nextPo: { increment: 1 } }, select: { nextPo: true } });
      return tx.purchaseOrder.create({
        data: {
          tenantId: me.tenantId,
          number: `PO-${String(nextPo - 1).padStart(5, '0')}`,
          supplierId: supplier.id,
          note: body.note,
          createdById: me.sub,
          lines: { create: body.lines.map((l) => ({ tenantId: me.tenantId, drugId: l.drugId, quantity: l.quantity, unitCost: l.unitCost?.toFixed(2) ?? null })) },
        },
        include,
      });
    });
    await this.audit.log(me, 'po.create', 'PurchaseOrder', po.id, { number: po.number, lines: body.lines.length });
    return withTotal(po);
  }

  /** Drafts only: change the note or the lines. */
  @Patch(':id')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>) {
    const po = await this.find(me, id);
    if (po.status !== 'DRAFT') throw new ConflictException('Only a draft can be changed');
    if (body.lines) await this.checkDrugs(me, body.lines);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (body.lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: body.lines.map((l) => ({ tenantId: me.tenantId, purchaseOrderId: id, drugId: l.drugId, quantity: l.quantity, unitCost: l.unitCost?.toFixed(2) ?? null })),
        });
      }
      return tx.purchaseOrder.update({ where: { id }, data: { note: body.note }, include });
    });
    await this.audit.log(me, 'po.update', 'PurchaseOrder', id, { number: po.number });
    return withTotal(updated);
  }

  @Post(':id/order')
  async markOrdered(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const po = await this.find(me, id);
    if (po.status !== 'DRAFT') throw new ConflictException('This order was already sent');
    const updated = await this.prisma.client.purchaseOrder.update({ where: { id }, data: { status: 'ORDERED', orderedAt: new Date() }, include });
    await this.audit.log(me, 'po.order', 'PurchaseOrder', id, { number: po.number });
    return withTotal(updated);
  }

  /** Closes an order that won't be (fully) delivered. What was already received stays in stock. */
  @Post(':id/cancel')
  async cancel(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const po = await this.find(me, id);
    if (po.status === 'RECEIVED' || po.status === 'CANCELLED') throw new ConflictException(`This order is already ${po.status.toLowerCase()}`);
    const updated = await this.prisma.client.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', closedAt: new Date() }, include });
    await this.audit.log(me, 'po.cancel', 'PurchaseOrder', id, { number: po.number });
    return withTotal(updated);
  }
}

import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, DAY_PATTERN, dayRange } from '../common/clinic-day.js';
import { fromCents, toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FORMULARY } from './formulary.js';
import { receivingStore, storeMode } from './stores.js';

/** Stock expiring within this many days is flagged as "expiring soon". */
export const EXPIRY_WARNING_DAYS = 90;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();
const price = z.number().min(0).max(1_000_000);

const DrugSchema = z.object({
  genericName: z.string().trim().min(2).max(200),
  brandName: optionalText(200),
  drugClass: optionalText(100),
  form: z.string().trim().min(2).max(50),
  strength: optionalText(50),
  unit: z.string().trim().min(1).max(30),
  sellPrice: price,
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  // How it is bought: 100 tablets to a box. Stock and prices stay per unit.
  packSize: z.number().int().min(2, 'A pack holds at least 2 units').max(100_000).nullable().optional(),
  packName: optionalText(30),
  // Narcotic or psychotropic: kept in the controlled-drug register, never sold over the counter.
  controlled: z.enum(['NARCOTIC', 'PSYCHOTROPIC']).nullable().optional(),
});
const DrugUpdateSchema = DrugSchema.partial().extend({ active: z.boolean().optional() });

/** Many drugs at once: picked from the starter list or imported from a spreadsheet. */
const BulkDrugSchema = z.object({ items: z.array(DrugSchema).min(1, 'Choose at least one drug').max(500) });

/** The same drug, form and strength counts as already in the list. */
const drugKey = (d: { genericName: string; strength?: string | null; form: string }) =>
  [d.genericName, d.strength ?? '', d.form].map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

const ReceiptSchema = z.object({
  supplierId: z.uuid().optional(),
  purchaseOrderId: z.uuid().optional(), // the order this delivery fills (its received quantities go up)
  storeId: z.uuid().optional(), // several stores: where the delivery goes (default: the main store)
  receiptRef: optionalText(100),
  items: z
    .array(
      z.object({
        drugId: z.uuid(),
        batchNo: z.string().trim().min(1).max(50),
        expiryDate: z.string().regex(DAY_PATTERN, 'Use YYYY-MM-DD'),
        quantity: z.number().int().min(1).max(1_000_000),
        costPrice: price,
      }),
    )
    .min(1, 'Add at least one item')
    .max(50),
});

/** A physical stock count: what is actually on the shelf, per batch. */
const CountSchema = z.object({
  lines: z.array(z.object({ batchId: z.uuid(), counted: z.number().int().min(0).max(10_000_000) })).min(1).max(500),
  note: optionalText(300),
});

const ADJUST_REASONS = ['DAMAGED', 'LOST', 'COUNT_CORRECTION', 'RETURNED_TO_SUPPLIER', 'OTHER'] as const;
const AdjustSchema = z
  .object({
    batchId: z.uuid(),
    quantity: z
      .number()
      .int()
      .refine((n) => n !== 0, 'Quantity cannot be zero'),
    reason: z.enum(ADJUST_REASONS),
    note: optionalText(300),
  })
  .refine((a) => a.reason !== 'OTHER' || !!a.note, { message: 'Explain the adjustment', path: ['note'] })
  .refine((a) => a.reason === 'COUNT_CORRECTION' || a.quantity < 0, {
    message: 'Only a count correction can add stock; receive new stock instead',
    path: ['quantity'],
  });

const ListSchema = z.object({
  q: z.string().trim().default(''),
  filter: z.enum(['all', 'low', 'expiring', 'expired', 'inactive']).default('all'),
});

const SupplierSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: optionalText(50),
  contactPerson: optionalText(100),
  tin: optionalText(30),
});
const SupplierUpdateSchema = SupplierSchema.partial().extend({ active: z.boolean().optional() });

const INVENTORY = ['ADMIN', 'PHARMACIST'] as const;

@Controller()
@Roles(...INVENTORY)
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Drugs with usable stock, expiring and expired quantities, value and alerts. */
  @Get('inventory')
  async list(@CurrentUser() me: AuthUser, @Query(new ZodPipe(ListSchema)) { q, filter }: z.infer<typeof ListSchema>) {
    const today = dayRange(clinicDay()).start;
    const soon = new Date(today.getTime() + EXPIRY_WARNING_DAYS * 86_400_000);
    const { multi } = await storeMode(this.prisma.client, me.tenantId);
    const words = q.split(/\s+/).filter(Boolean);
    const drugs = await this.prisma.client.drug.findMany({
      where: {
        tenantId: me.tenantId,
        active: filter !== 'inactive',
        AND: words.map((w) => ({
          OR: [
            { genericName: { contains: w, mode: 'insensitive' as const } },
            { brandName: { contains: w, mode: 'insensitive' as const } },
            { drugClass: { contains: w, mode: 'insensitive' as const } },
          ],
        })),
      },
      orderBy: { genericName: 'asc' },
      include: { batches: { where: { quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' }, include: { store: { select: { id: true, name: true, createdAt: true } } } } },
    });

    const rows = drugs.map(({ batches, ...d }) => {
      const usable = batches.filter((b) => b.expiryDate >= today);
      const expired = batches.filter((b) => b.expiryDate < today);
      const onHand = usable.reduce((s, b) => s + b.quantity, 0);
      return {
        ...d,
        onHand,
        expiringSoon: usable.filter((b) => b.expiryDate < soon).reduce((s, b) => s + b.quantity, 0),
        expiredQty: expired.reduce((s, b) => s + b.quantity, 0),
        nearestExpiry: usable[0]?.expiryDate ?? null,
        stockValueCents: usable.reduce((s, b) => s + b.quantity * toCents(b.costPrice), 0),
        expiredValueCents: expired.reduce((s, b) => s + b.quantity * toCents(b.costPrice), 0),
        low: d.reorderLevel > 0 && onHand <= d.reorderLevel,
        // Several stores: usable units in each store that holds some.
        byStore: multi
          ? Object.values(
              usable.reduce<Record<string, { storeId: string; name: string; quantity: number; order: number }>>((acc, b) => {
                const key = b.store?.id ?? 'none';
                acc[key] ??= { storeId: key, name: b.store?.name ?? 'No store', quantity: 0, order: b.store?.createdAt.getTime() ?? 0 };
                acc[key].quantity += b.quantity;
                return acc;
              }, {}),
            )
              // Always the same order: the stores as they were set up (main store first).
              .sort((x, y) => x.order - y.order)
              .map(({ order: _order, ...b }) => b)
          : [],
      };
    });

    const summary = {
      multiStore: multi,
      drugs: rows.length,
      stockValue: fromCents(rows.reduce((s, r) => s + r.stockValueCents, 0)),
      low: rows.filter((r) => r.low).length,
      expiring: rows.filter((r) => r.expiringSoon > 0).length,
      expired: rows.filter((r) => r.expiredQty > 0).length,
      expiredValue: fromCents(rows.reduce((s, r) => s + r.expiredValueCents, 0)),
      expiryWarningDays: EXPIRY_WARNING_DAYS,
    };
    const shown =
      filter === 'low' ? rows.filter((r) => r.low) : filter === 'expiring' ? rows.filter((r) => r.expiringSoon > 0) : filter === 'expired' ? rows.filter((r) => r.expiredQty > 0) : rows;
    return {
      summary,
      drugs: shown.map(({ stockValueCents, expiredValueCents, ...r }) => ({ ...r, stockValue: fromCents(stockValueCents), expiredValue: fromCents(expiredValueCents) })),
    };
  }

  @Post('drugs')
  async createDrug(@CurrentUser() me: AuthUser, @Body(new ZodPipe(DrugSchema)) body: z.infer<typeof DrugSchema>) {
    const exists = await this.prisma.client.drug.findFirst({
      where: { tenantId: me.tenantId, genericName: { equals: body.genericName, mode: 'insensitive' }, strength: body.strength ?? null, form: body.form },
    });
    if (exists) throw new ConflictException('This drug, form and strength is already in the list');
    const drug = await this.prisma.client.drug.create({ data: { ...body, sellPrice: body.sellPrice.toFixed(2), tenantId: me.tenantId } });
    await this.audit.log(me, 'drug.create', 'Drug', drug.id, { genericName: drug.genericName, sellPrice: body.sellPrice.toFixed(2) });
    return drug;
  }

  /** The starter list of common medicines, each marked when the clinic already has it. */
  @Get('drugs/starter')
  async starter(@CurrentUser() me: AuthUser) {
    const have = await this.prisma.client.drug.findMany({ where: { tenantId: me.tenantId }, select: { genericName: true, strength: true, form: true } });
    const keys = new Set(have.map(drugKey));
    return FORMULARY.map((f) => ({ ...f, inList: keys.has(drugKey(f)) }));
  }

  /**
   * Adds many drugs in one go (starter list, spreadsheet). Drugs already in the list are skipped
   * and named in the reply, so importing the same file twice adds nothing twice.
   */
  @Post('drugs/bulk')
  async bulkDrugs(@CurrentUser() me: AuthUser, @Body(new ZodPipe(BulkDrugSchema)) { items }: z.infer<typeof BulkDrugSchema>) {
    return this.prisma.client.$transaction(async (tx) => {
      // One import at a time per clinic, so two at once can't add the same drug twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`drugs:${me.tenantId}`}))`;
      const have = await tx.drug.findMany({ where: { tenantId: me.tenantId }, select: { genericName: true, strength: true, form: true } });
      const keys = new Set(have.map(drugKey));
      const created: string[] = [];
      const skipped: string[] = [];
      for (const item of items) {
        const label = [item.genericName, item.strength, item.form].filter(Boolean).join(' ');
        if (keys.has(drugKey(item))) {
          skipped.push(label);
          continue;
        }
        keys.add(drugKey(item));
        await tx.drug.create({ data: { ...item, sellPrice: item.sellPrice.toFixed(2), tenantId: me.tenantId } });
        created.push(label);
      }
      await this.audit.log(me, 'drug.import', 'Drug', undefined, { created: created.length, skipped: skipped.length }, tx);
      return { created, skipped };
    });
  }

  @Patch('drugs/:id')
  async updateDrug(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(DrugUpdateSchema)) body: z.infer<typeof DrugUpdateSchema>) {
    const drug = await this.findDrug(me, id);
    const updated = await this.prisma.client.drug.update({
      where: { id },
      data: { ...body, ...(body.sellPrice !== undefined && { sellPrice: body.sellPrice.toFixed(2) }) },
    });
    const priceChanged = body.sellPrice !== undefined && toCents(drug.sellPrice) !== toCents(body.sellPrice);
    await this.audit.log(me, 'drug.update', 'Drug', id, {
      fields: Object.keys(body),
      ...(priceChanged && { sellPrice: { from: drug.sellPrice.toString(), to: body.sellPrice!.toFixed(2) } }),
    });
    return updated;
  }

  /** One drug's batches (including empty and expired ones) and its latest stock movements. */
  @Get('drugs/:id/stock')
  async drugStock(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const drug = await this.findDrug(me, id);
    const db = this.prisma.client;
    const [batches, movements] = await Promise.all([
      db.stockBatch.findMany({ where: { drugId: id }, orderBy: [{ expiryDate: 'asc' }], include: { supplierRef: { select: { name: true } }, store: { select: { name: true } } } }),
      db.stockMovement.findMany({ where: { batch: { drugId: id } }, orderBy: { createdAt: 'desc' }, take: 50, include: { batch: { select: { batchNo: true } } } }),
    ]);
    const userIds = [...new Set(movements.map((m) => m.userId).filter((x): x is string => !!x))];
    const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const today = dayRange(clinicDay()).start;
    return {
      drug,
      batches: batches.map((b) => ({ ...b, expired: b.expiryDate < today })),
      movements: movements.map((m) => ({ ...m, userName: m.userId ? (users.get(m.userId) ?? null) : null })),
    };
  }

  /** Receives a delivery. A batch number seen before for the same drug is topped up (same expiry only). */
  @Post('inventory/receipts')
  async receive(@CurrentUser() me: AuthUser, @Body(new ZodPipe(ReceiptSchema)) body: z.infer<typeof ReceiptSchema>) {
    const today = clinicDay();
    return this.prisma.client.$transaction(async (tx) => {
      const supplier = body.supplierId ? await tx.supplier.findFirst({ where: { id: body.supplierId, tenantId: me.tenantId } }) : null;
      if (body.supplierId && !supplier) throw new NotFoundException('Supplier not found');
      // Several stores: into the chosen store, or the main store. One store: batches have none.
      const { multi } = await storeMode(tx, me.tenantId);
      const store = !multi
        ? null
        : body.storeId
          ? await tx.store.findFirst({ where: { id: body.storeId, tenantId: me.tenantId, active: true } })
          : await receivingStore(tx, me.tenantId);
      if (multi && !store) throw new NotFoundException('Store not found');

      const warnings: string[] = [];
      const received: { drug: string; batchNo: string; quantity: number }[] = [];
      for (const item of body.items) {
        const drug = await tx.drug.findFirst({ where: { id: item.drugId, tenantId: me.tenantId } });
        if (!drug) throw new NotFoundException('Drug not found');
        if (item.expiryDate <= today) throw new ConflictException(`${drug.genericName} batch ${item.batchNo} is already expired`);
        if (toCents(item.costPrice) > toCents(drug.sellPrice)) {
          warnings.push(`${drug.genericName}: cost ${item.costPrice.toFixed(2)} is above the selling price ${drug.sellPrice.toString()}`);
        }

        const expiryDate = new Date(item.expiryDate);
        const existing = await tx.stockBatch.findFirst({ where: { drugId: drug.id, batchNo: item.batchNo, storeId: store?.id ?? null } });
        let batchId: string;
        if (existing) {
          if (existing.expiryDate.toISOString().slice(0, 10) !== item.expiryDate) {
            throw new ConflictException(`${drug.genericName} batch ${item.batchNo} is already recorded with a different expiry date`);
          }
          batchId = existing.id;
          await tx.stockBatch.update({ where: { id: batchId }, data: { quantity: { increment: item.quantity } } });
        } else {
          batchId = (
            await tx.stockBatch.create({
              data: {
                drugId: drug.id,
                batchNo: item.batchNo,
                expiryDate,
                quantity: item.quantity,
                costPrice: item.costPrice.toFixed(2),
                supplierId: supplier?.id,
                supplier: supplier?.name,
                receiptRef: body.receiptRef,
                receivedById: me.sub,
                storeId: store?.id,
              },
            })
          ).id;
        }
        await tx.stockMovement.create({ data: { batchId, type: 'RECEIPT', quantity: item.quantity, reference: body.receiptRef, userId: me.sub } });
        received.push({ drug: drug.genericName, batchNo: item.batchNo, quantity: item.quantity });
      }
      if (body.purchaseOrderId) {
        const po = await tx.purchaseOrder.findFirst({ where: { id: body.purchaseOrderId, tenantId: me.tenantId }, include: { lines: true } });
        if (!po) throw new NotFoundException('Purchase order not found');
        if (po.status !== 'ORDERED' && po.status !== 'PARTLY_RECEIVED') throw new ConflictException(`Purchase order ${po.number} is ${po.status.toLowerCase().replace('_', ' ')}`);
        if (supplier && po.supplierId !== supplier.id) throw new ConflictException('This delivery is from a different supplier than the purchase order');
        for (const line of po.lines) {
          const qty = body.items.filter((i) => i.drugId === line.drugId).reduce((s, i) => s + i.quantity, 0);
          if (qty) await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: { increment: qty } } });
        }
        const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const done = lines.every((l) => l.receivedQty >= l.quantity);
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? 'RECEIVED' : 'PARTLY_RECEIVED', ...(done && { closedAt: new Date() }) } });
      }
      await this.audit.log(me, 'stock.receive', 'Supplier', supplier?.id, { receiptRef: body.receiptRef, purchaseOrderId: body.purchaseOrderId, items: received }, tx);
      return { received, warnings };
    });
  }

  @Post('inventory/adjustments')
  async adjust(@CurrentUser() me: AuthUser, @Body(new ZodPipe(AdjustSchema)) body: z.infer<typeof AdjustSchema>) {
    return this.prisma.client.$transaction(async (tx) => {
      const batch = await tx.stockBatch.findFirst({ where: { id: body.batchId, drug: { tenantId: me.tenantId } }, include: { drug: true } });
      if (!batch) throw new NotFoundException('Batch not found');
      // Atomic: never lets a batch go below zero, even with concurrent dispensing.
      const changed = await tx.$executeRaw`
        UPDATE "StockBatch" SET "quantity" = "quantity" + ${body.quantity}
        WHERE "id" = ${batch.id} AND "quantity" + ${body.quantity} >= 0`;
      if (changed !== 1) throw new ConflictException(`Batch ${batch.batchNo} has only ${batch.quantity} ${batch.drug.unit} left`);
      await tx.stockMovement.create({
        data: {
          batchId: batch.id,
          type: 'ADJUSTMENT',
          quantity: body.quantity,
          reason: body.note ? `${body.reason}: ${body.note}` : body.reason,
          userId: me.sub,
        },
      });
      await this.audit.log(me, 'stock.adjust', 'StockBatch', batch.id, { drug: batch.drug.genericName, quantity: body.quantity, reason: body.reason }, tx);
      return tx.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    });
  }

  /** Every batch with stock on the shelf (expired ones too: a count should find them), for a stock count sheet. */
  @Get('inventory/batches')
  async batches(@CurrentUser() me: AuthUser) {
    return this.prisma.client.stockBatch.findMany({
      where: { drug: { tenantId: me.tenantId, active: true }, quantity: { gt: 0 } },
      orderBy: [{ drug: { genericName: 'asc' } }, { expiryDate: 'asc' }],
      select: {
        id: true,
        batchNo: true,
        expiryDate: true,
        quantity: true,
        costPrice: true,
        drug: { select: { id: true, genericName: true, strength: true, form: true, unit: true } },
        store: { select: { name: true } },
      },
    });
  }

  /**
   * Records a stock count: each counted batch is set to what is on the shelf, and every difference
   * is kept as a count-correction movement (with its value at cost) for the loss report.
   */
  @Post('inventory/counts')
  async count(@CurrentUser() me: AuthUser, @Body(new ZodPipe(CountSchema)) body: z.infer<typeof CountSchema>) {
    if (new Set(body.lines.map((l) => l.batchId)).size !== body.lines.length) throw new ConflictException('Each batch may be counted only once');
    return this.prisma.client.$transaction(async (tx) => {
      const differences: { drug: string; batchNo: string; system: number; counted: number; difference: number; value: string }[] = [];
      for (const line of body.lines) {
        // Lock the batch so dispensing during the count can't be lost or double-counted.
        const [row] = await tx.$queryRaw<{ id: string }[]>`
          SELECT b."id" FROM "StockBatch" b JOIN "Drug" d ON d."id" = b."drugId"
          WHERE b."id" = ${line.batchId} AND d."tenantId" = ${me.tenantId} FOR UPDATE OF b`;
        if (!row) throw new NotFoundException('Batch not found');
        const batch = await tx.stockBatch.findUniqueOrThrow({ where: { id: line.batchId }, include: { drug: true } });
        const diff = line.counted - batch.quantity;
        if (diff === 0) continue;
        await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: line.counted } });
        await tx.stockMovement.create({
          data: { batchId: batch.id, type: 'ADJUSTMENT', quantity: diff, reason: body.note ? `COUNT_CORRECTION: ${body.note}` : 'COUNT_CORRECTION: stock count', userId: me.sub },
        });
        differences.push({
          drug: batch.drug.genericName,
          batchNo: batch.batchNo,
          system: batch.quantity,
          counted: line.counted,
          difference: diff,
          value: fromCents(toCents(batch.costPrice) * diff),
        });
      }
      await this.audit.log(me, 'stock.count', 'Tenant', me.tenantId, { batches: body.lines.length, differences: differences.length }, tx);
      return { counted: body.lines.length, differences };
    });
  }

  /** Removes all expired stock from the shelves, recording the loss. */
  @Post('inventory/expired/write-off')
  async writeOffExpired(@CurrentUser() me: AuthUser) {
    const today = dayRange(clinicDay()).start;
    return this.prisma.client.$transaction(async (tx) => {
      const batches = await tx.$queryRaw<{ id: string; quantity: number; costPrice: string; batchNo: string; genericName: string }[]>`
        SELECT b."id", b."quantity", b."costPrice"::text AS "costPrice", b."batchNo", d."genericName"
        FROM "StockBatch" b JOIN "Drug" d ON d."id" = b."drugId"
        WHERE d."tenantId" = ${me.tenantId} AND b."quantity" > 0 AND b."expiryDate" < ${today}
        FOR UPDATE OF b`;
      let units = 0;
      let value = 0;
      for (const b of batches) {
        await tx.stockBatch.update({ where: { id: b.id }, data: { quantity: 0 } });
        await tx.stockMovement.create({ data: { batchId: b.id, type: 'EXPIRED', quantity: -b.quantity, reason: 'Expired stock written off', userId: me.sub } });
        units += b.quantity;
        value += b.quantity * toCents(b.costPrice);
      }
      const summary = { batches: batches.length, units, value: fromCents(value), items: batches.map((b) => `${b.genericName} ${b.batchNo} × ${b.quantity}`) };
      if (batches.length) await this.audit.log(me, 'stock.writeoff', 'Tenant', me.tenantId, summary, tx);
      return summary;
    });
  }

  @Get('suppliers')
  suppliers(@CurrentUser() me: AuthUser) {
    return this.prisma.client.supplier.findMany({ where: { tenantId: me.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  @Post('suppliers')
  async createSupplier(@CurrentUser() me: AuthUser, @Body(new ZodPipe(SupplierSchema)) body: z.infer<typeof SupplierSchema>) {
    const exists = await this.prisma.client.supplier.findFirst({ where: { tenantId: me.tenantId, name: { equals: body.name, mode: 'insensitive' } } });
    if (exists) throw new ConflictException('A supplier with this name already exists');
    const s = await this.prisma.client.supplier.create({ data: { ...body, tenantId: me.tenantId } });
    await this.audit.log(me, 'supplier.create', 'Supplier', s.id, { name: s.name });
    return s;
  }

  @Patch('suppliers/:id')
  async updateSupplier(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(SupplierUpdateSchema)) body: z.infer<typeof SupplierUpdateSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Supplier not found');
    const s = await this.prisma.client.supplier.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!s) throw new NotFoundException('Supplier not found');
    const updated = await this.prisma.client.supplier.update({ where: { id }, data: body });
    await this.audit.log(me, 'supplier.update', 'Supplier', id, { fields: Object.keys(body) });
    return updated;
  }

  private async findDrug(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Drug not found');
    const drug = await this.prisma.client.drug.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!drug) throw new NotFoundException('Drug not found');
    return drug;
  }
}

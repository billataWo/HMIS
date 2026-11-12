import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Prisma } from '@hmis/db';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const StoreSchema = z.object({
  name: z.string().trim().min(2, 'Give the store a name').max(60),
  dispensary: z.boolean().default(false),
});
const StoreUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  dispensary: z.boolean().optional(),
  active: z.boolean().optional(),
});
const TransferSchema = z
  .object({
    fromStoreId: z.uuid(),
    toStoreId: z.uuid(),
    note: z
      .string()
      .trim()
      .max(300)
      .transform((s) => s || undefined)
      .optional(),
    items: z
      .array(z.object({ drugId: z.uuid(), quantity: z.number().int().min(1).max(1_000_000) }))
      .min(1, 'Add at least one drug')
      .max(100)
      .refine((items) => new Set(items.map((i) => i.drugId)).size === items.length, 'Each drug may appear only once'),
  })
  .refine((b) => b.fromStoreId !== b.toStoreId, { message: 'Choose two different stores', path: ['toStoreId'] });

/**
 * The clinic's stores (main store, dispensary, a ward…) and stock transfers between them. Used
 * when "Several stores" is on in Settings. A transfer takes the earliest-expiring usable batches
 * from one store and puts the same batches (number, expiry, cost) in the other; each portion is a
 * pair of permanent stock movements, so stock, the drug's history and the controlled-drug
 * register all show it.
 */
@Controller()
@Roles('ADMIN', 'PHARMACIST')
export class StoresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Stores with their usable stock value and number of drugs. */
  @Get('stores')
  async list(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const today = dayRange(clinicDay()).start;
    const [stores, tenant] = await Promise.all([
      db.store.findMany({
        where: { tenantId: me.tenantId },
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
        include: { batches: { where: { quantity: { gt: 0 }, expiryDate: { gte: today } }, select: { drugId: true, quantity: true } } },
      }),
      db.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { multiStore: true } }),
    ]);
    return {
      multiStore: tenant.multiStore,
      stores: stores.map(({ batches, ...s }) => ({ ...s, drugs: new Set(batches.map((b) => b.drugId)).size, units: batches.reduce((n, b) => n + b.quantity, 0) })),
    };
  }

  @Post('stores')
  async create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(StoreSchema)) body: z.infer<typeof StoreSchema>) {
    await this.requireMulti(me);
    if (await this.prisma.client.store.findFirst({ where: { tenantId: me.tenantId, name: { equals: body.name, mode: 'insensitive' } } })) {
      throw new ConflictException(`There is already a store called ${body.name}`);
    }
    const store = await this.prisma.client.store.create({ data: { tenantId: me.tenantId, ...body } });
    await this.audit.log(me, 'store.create', 'Store', store.id, body);
    return store;
  }

  @Patch('stores/:id')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(StoreUpdateSchema)) body: z.infer<typeof StoreUpdateSchema>) {
    const db = this.prisma.client;
    const store = await this.store(me, id);
    if (body.active === false || body.dispensary === false) {
      if (body.active === false) {
        const stock = await db.stockBatch.aggregate({ where: { storeId: id, quantity: { gt: 0 } }, _sum: { quantity: true } });
        if (stock._sum.quantity) throw new ConflictException(`${store.name} still holds ${stock._sum.quantity} units: transfer them out first`);
      }
      // Dispensing needs somewhere to take stock from.
      const others = await db.store.count({ where: { tenantId: me.tenantId, dispensary: true, active: true, id: { not: id } } });
      if (store.dispensary && store.active && !others) throw new ConflictException('Keep at least one dispensary: the pharmacy dispenses from it');
    }
    if (body.name && (await db.store.findFirst({ where: { tenantId: me.tenantId, id: { not: id }, name: { equals: body.name, mode: 'insensitive' } } }))) {
      throw new ConflictException(`There is already a store called ${body.name}`);
    }
    const updated = await db.store.update({ where: { id }, data: body });
    await this.audit.log(me, 'store.update', 'Store', id, body);
    return updated;
  }

  /** Recent transfers, newest first, each with what was moved. */
  @Get('inventory/transfers')
  async transfers(@CurrentUser() me: AuthUser) {
    const db = this.prisma.client;
    const transfers = await db.stockTransfer.findMany({ where: { tenantId: me.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
    if (!transfers.length) return [];
    const [stores, users, moves] = await Promise.all([
      db.store.findMany({ where: { tenantId: me.tenantId }, select: { id: true, name: true } }),
      db.user.findMany({ where: { tenantId: me.tenantId, id: { in: [...new Set(transfers.map((t) => t.userId))] } }, select: { id: true, fullName: true } }),
      db.stockMovement.findMany({
        where: { type: 'TRANSFER_OUT', reference: { in: transfers.map((t) => t.id) } },
        include: { batch: { select: { batchNo: true, expiryDate: true, drug: { select: { id: true, genericName: true, strength: true, form: true, unit: true } } } } },
      }),
    ]);
    const storeName = new Map(stores.map((s) => [s.id, s.name]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    return transfers.map((t) => ({
      ...t,
      from: storeName.get(t.fromStoreId) ?? '—',
      to: storeName.get(t.toStoreId) ?? '—',
      by: userName.get(t.userId) ?? null,
      lines: moves
        .filter((m) => m.reference === t.id)
        .map((m) => ({ drug: m.batch.drug, batchNo: m.batch.batchNo, expiryDate: m.batch.expiryDate, quantity: -m.quantity })),
    }));
  }

  @Post('inventory/transfers')
  async transfer(@CurrentUser() me: AuthUser, @Body(new ZodPipe(TransferSchema)) body: z.infer<typeof TransferSchema>) {
    await this.requireMulti(me);
    const from = await this.store(me, body.fromStoreId);
    const to = await this.store(me, body.toStoreId);
    if (!from.active || !to.active) throw new ConflictException('Both stores must be in use');
    const usable = dayRange(clinicDay()).start;

    return this.prisma.client.$transaction(async (tx) => {
      const { nextTransfer } = await tx.tenant.update({ where: { id: me.tenantId }, data: { nextTransfer: { increment: 1 } }, select: { nextTransfer: true } });
      const number = `TR-${String(nextTransfer - 1).padStart(5, '0')}`;
      const transfer = await tx.stockTransfer.create({ data: { tenantId: me.tenantId, number, fromStoreId: from.id, toStoreId: to.id, note: body.note, userId: me.sub } });
      const reason = `${number}: ${from.name} → ${to.name}`;

      for (const item of body.items) {
        const drug = await tx.drug.findFirst({ where: { id: item.drugId, tenantId: me.tenantId } });
        if (!drug) throw new NotFoundException('Drug not found');
        // Earliest expiry first; locked so a dispense or another transfer can't take the same units.
        const batches = await tx.$queryRaw<{ id: string; quantity: number }[]>`
          SELECT "id", "quantity" FROM "StockBatch"
          WHERE "drugId" = ${drug.id} AND "storeId" = ${from.id} AND "quantity" > 0 AND "expiryDate" >= ${usable}
          ORDER BY "expiryDate" ASC, "receivedAt" ASC
          FOR UPDATE`;
        const available = batches.reduce((s, b) => s + b.quantity, 0);
        if (available < item.quantity) {
          throw new ConflictException(`${from.name} has only ${available} ${drug.unit} of ${drug.genericName} in date (${item.quantity} asked)`);
        }
        let left = item.quantity;
        for (const b of batches) {
          if (!left) break;
          const take = Math.min(left, b.quantity);
          const src = await tx.stockBatch.update({ where: { id: b.id }, data: { quantity: { decrement: take } } });
          // The same batch in the other store: topped up if it is already there.
          const same = await tx.stockBatch.findFirst({ where: { drugId: drug.id, storeId: to.id, batchNo: src.batchNo, expiryDate: src.expiryDate } });
          const dest = same
            ? await tx.stockBatch.update({ where: { id: same.id }, data: { quantity: { increment: take } } })
            : await tx.stockBatch.create({
                data: {
                  drugId: drug.id,
                  storeId: to.id,
                  batchNo: src.batchNo,
                  expiryDate: src.expiryDate,
                  quantity: take,
                  costPrice: src.costPrice,
                  supplier: src.supplier,
                  supplierId: src.supplierId,
                  receiptRef: src.receiptRef,
                  receivedById: me.sub,
                } satisfies Prisma.StockBatchUncheckedCreateInput,
              });
          await tx.stockMovement.create({ data: { batchId: src.id, type: 'TRANSFER_OUT', quantity: -take, reference: transfer.id, reason, userId: me.sub } });
          await tx.stockMovement.create({ data: { batchId: dest.id, type: 'TRANSFER_IN', quantity: take, reference: transfer.id, reason, userId: me.sub } });
          left -= take;
        }
      }
      await this.audit.log(me, 'stock.transfer', 'StockTransfer', transfer.id, { number, from: from.name, to: to.name, items: body.items.length }, tx);
      return transfer;
    });
  }

  private async store(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Store not found');
    const store = await this.prisma.client.store.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async requireMulti(me: AuthUser) {
    const t = await this.prisma.client.tenant.findUniqueOrThrow({ where: { id: me.tenantId }, select: { multiStore: true } });
    if (!t.multiStore) throw new ConflictException('Turn on "Several stores" in Settings first');
  }
}

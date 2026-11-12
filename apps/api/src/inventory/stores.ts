import type { Prisma } from '@hmis/db';

type Db = Pick<Prisma.TransactionClient, 'tenant' | 'store' | 'stockBatch'>;

/**
 * Where dispensing may take stock from. A clinic with one store (the switch off) dispenses from
 * every batch; with several stores, only from batches kept in a dispensary store.
 */
export async function storeMode(db: Pick<Prisma.TransactionClient, 'tenant' | 'store'>, tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { multiStore: true } });
  if (!t.multiStore) return { multi: false as const, dispensaryIds: [] as string[] };
  const stores = await db.store.findMany({ where: { tenantId, dispensary: true, active: true }, select: { id: true } });
  return { multi: true as const, dispensaryIds: stores.map((s) => s.id) };
}

/** Batch filter for "can be dispensed from" (Prisma where). */
export const dispensableWhere = (mode: Awaited<ReturnType<typeof storeMode>>): Prisma.StockBatchWhereInput =>
  mode.multi ? { storeId: { in: mode.dispensaryIds } } : {};

/**
 * Switching to several stores: a Main store (deliveries) and a Dispensary (dispensing) the first
 * time, and any stock not yet in a store goes to the dispensary, so dispensing carries on as it was.
 */
export async function ensureStores(db: Db, tenantId: string) {
  if (!(await db.store.count({ where: { tenantId } }))) {
    await db.store.create({ data: { tenantId, name: 'Main store' } });
    await db.store.create({ data: { tenantId, name: 'Dispensary', dispensary: true } });
  }
  const dispensary =
    (await db.store.findFirst({ where: { tenantId, dispensary: true, active: true }, orderBy: { createdAt: 'asc' } })) ??
    (await db.store.findFirstOrThrow({ where: { tenantId, active: true }, orderBy: { createdAt: 'asc' } }));
  await db.stockBatch.updateMany({ where: { storeId: null, drug: { tenantId } }, data: { storeId: dispensary.id } });
}

/** Where a delivery goes by default: the first store that isn't a dispensary (the main store). */
export async function receivingStore(db: Pick<Prisma.TransactionClient, 'store'>, tenantId: string) {
  return (
    (await db.store.findFirst({ where: { tenantId, active: true, dispensary: false }, orderBy: { createdAt: 'asc' } })) ??
    (await db.store.findFirst({ where: { tenantId, active: true }, orderBy: { createdAt: 'asc' } }))
  );
}

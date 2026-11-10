/**
 * The sync engine shared by the clinic server (capture, send, bootstrap) and the cloud (apply,
 * export). Plain functions over a Prisma client so the CLI can use them without Nest.
 * See README.md in this folder for the design.
 */

import { createHash } from 'node:crypto';

/** Sync tokens are stored only as this hash. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Raw-query surface of a Prisma client or transaction. */
export type Raw = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

/** Server bookkeeping, never sent anywhere. Every other table in the schema is clinic data. */
export const NOT_SYNCED = new Set(['_prisma_migrations', 'BackupEvent', 'SyncOutbox', 'SyncState', 'SyncClient', 'IdempotentRequest', 'DisplayScreen',
  // The HMIS platform: subscriptions belong to the cloud, never to a clinic server.
  'Plan', 'Subscription', 'ClinicRequest', 'PlatformUser', 'PlatformAuditLog', 'PlatformSetting', 'PlatformInvoice', 'PlatformPayment', 'PlatformCheckout', 'InstalledLicence']);

export type TableMeta = { name: string; columns: Set<string>; pk: string[]; deps: string[] };
export type Tables = Map<string, TableMeta>;

/** One change as it travels: the row and key stay JSON text, exactly as PostgreSQL wrote them. */
export type Change = { seq: string; table: string; op: 'U' | 'D'; key: string; row: string | null };

export class SyncError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export async function loadTables(db: Raw): Promise<Tables> {
  const rows = await db.$queryRawUnsafe<{ name: string; rls: boolean; columns: string[]; pk: string[] | null; deps: string[] | null }[]>(`
    SELECT c.relname AS name, c.relrowsecurity AS rls,
      (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
      (SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum)) FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = c.oid AND i.indisprimary) AS pk,
      (SELECT array_agg(DISTINCT p.relname::text) FROM pg_constraint f JOIN pg_class p ON p.oid = f.confrelid
        WHERE f.conrelid = c.oid AND f.contype = 'f' AND f.confrelid <> c.oid) AS deps
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'`);
  const tables: Tables = new Map();
  const unprotected: string[] = [];
  for (const r of rows) {
    if (NOT_SYNCED.has(r.name) || !r.pk) continue;
    if (!r.rls) unprotected.push(r.name);
    tables.set(r.name, { name: r.name, columns: new Set(r.columns), pk: r.pk, deps: (r.deps ?? []).filter((d) => !NOT_SYNCED.has(d)) });
  }
  // Every clinic table is read under row-level security (exports, a new clinic server's copy) and
  // deleted under it. One without it would give one clinic every clinic's rows: stop instead. A
  // new table either gets row-level security in its migration or goes in NOT_SYNCED.
  if (unprotected.length) throw new SyncError(`These tables have no row-level security: ${unprotected.join(', ')}. Add it, or list them in NOT_SYNCED.`, 'TABLE_NOT_PROTECTED');
  return tables;
}

/** Parents before children, so a full copy can be inserted in order. */
export function dependencyOrder(tables: Tables): string[] {
  const order: string[] = [];
  const done = new Set<string>();
  const visit = (name: string, path: Set<string>) => {
    if (done.has(name) || path.has(name)) return; // a cycle would be resolved by apply's retry
    path.add(name);
    for (const d of tables.get(name)?.deps ?? []) if (tables.has(d)) visit(d, path);
    path.delete(name);
    done.add(name);
    order.push(name);
  };
  for (const name of [...tables.keys()].sort()) visit(name, new Set());
  return order;
}

function isForeignKeyError(e: unknown) {
  const text = `${(e as Error)?.message ?? ''} ${JSON.stringify(e) ?? ''}`;
  return text.includes('23503') || /foreign key/i.test(text);
}

function statement(t: TableMeta, change: Change): { sql: string; param: string } {
  const pkList = t.pk.map(q).join(', ');
  if (change.op === 'D') {
    return {
      sql: `DELETE FROM ${q(t.name)} WHERE (${pkList}) = (SELECT ${pkList} FROM jsonb_populate_record(NULL::${q(t.name)}, $1::jsonb))`,
      param: change.key,
    };
  }
  if (!change.row) throw new SyncError(`Change ${change.seq} on ${t.name} has no row`, 'BAD_CHANGE');
  // Only the columns both sides know: a newer cloud may have extra columns (they keep their defaults).
  const cols = Object.keys(JSON.parse(change.row) as object).filter((c) => t.columns.has(c));
  const colList = cols.map(q).join(', ');
  const updates = cols.filter((c) => !t.pk.includes(c)).map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
  return {
    sql:
      `INSERT INTO ${q(t.name)} (${colList}) SELECT ${colList} FROM jsonb_populate_record(NULL::${q(t.name)}, $1::jsonb) ` +
      `ON CONFLICT (${pkList}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`,
    param: change.row,
  };
}

/**
 * Applies changes in order inside the caller's transaction. Each change runs in a savepoint; one
 * that fails only because its parent row comes later in the same batch is retried after the rest.
 * Anything else (row-level security, a unique clash, a bad value) fails the whole batch, which
 * is then retried as a whole later, so a batch is applied completely or not at all.
 */
export async function applyChanges(tx: Raw, tables: Tables, changes: Change[]): Promise<number> {
  for (const c of changes) {
    if (!tables.has(c.table)) throw new SyncError(`Unknown table ${c.table}: update the cloud first`, 'UNKNOWN_TABLE');
  }
  let pending = changes;
  let applied = 0;
  while (pending.length) {
    const deferred: Change[] = [];
    let lastError: unknown;
    for (const change of pending) {
      const { sql, param } = statement(tables.get(change.table)!, change);
      await tx.$executeRawUnsafe('SAVEPOINT sync_change');
      try {
        await tx.$executeRawUnsafe(sql, param);
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT sync_change');
        applied++;
      } catch (e) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sync_change');
        if (!isForeignKeyError(e)) {
          throw new SyncError(`${change.table} ${change.key}: ${(e as Error).message.split('\n').slice(-1)[0]}`, 'APPLY_FAILED');
        }
        deferred.push(change);
        lastError = e;
      }
    }
    if (deferred.length === pending.length) {
      const c = deferred[0];
      throw new SyncError(`${c.table} ${c.key} refers to a row that is not there: ${(lastError as Error).message.split('\n').slice(-1)[0]}`, 'MISSING_PARENT');
    }
    pending = deferred;
  }
  return applied;
}

/** The newest migration this database has finished: the schema version both sides compare. */
export async function schemaVersion(db: Raw): Promise<string> {
  const [row] = await db.$queryRawUnsafe<{ v: string | null }[]>(
    `SELECT max(migration_name) AS v FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  return row?.v ?? '';
}

// --- Clinic server: capture and send ------------------------------------------------------------

/**
 * Changes ready to send: only from transactions older than every transaction still running, so
 * a change committed late with a lower sequence number is never skipped. Cut at about maxBytes.
 */
export async function readOutbox(owner: Raw, limit = 1000, maxBytes = 512_000): Promise<Change[]> {
  const rows = await owner.$queryRawUnsafe<{ seq: string; table: string; op: 'U' | 'D'; key: string; row: string | null }[]>(
    `SELECT "seq"::text AS seq, "tableName" AS "table", "op", "key"::text AS key, "row"::text AS row
       FROM "SyncOutbox" WHERE "xid" < pg_snapshot_xmin(pg_current_snapshot())
      ORDER BY "seq" LIMIT ${Math.max(1, Math.floor(limit))}`,
  );
  const batch: Change[] = [];
  let bytes = 0;
  for (const r of rows) {
    const size = r.key.length + (r.row?.length ?? 0) + 64;
    if (batch.length && bytes + size > maxBytes) break;
    batch.push(r);
    bytes += size;
  }
  return batch;
}

export async function ackOutbox(owner: Raw, seqs: string[]) {
  if (!seqs.length) return;
  await owner.$executeRawUnsafe(`DELETE FROM "SyncOutbox" WHERE "seq" = ANY ($1::bigint[])`, seqs);
}

/**
 * Turns capture on. With snapshot, also queues every existing row (parents first), so a cloud
 * that has never seen this clinic gets all of it. Writes are paused for the few seconds this
 * takes, so no change can slip between the copy and the capture.
 */
export async function enableCapture(owner: Raw & { $transaction: Function }, { snapshot }: { snapshot: boolean }) {
  const tables = await loadTables(owner);
  const order = dependencyOrder(tables);
  return (owner.$transaction as (fn: (tx: Raw) => Promise<number>, o: object) => Promise<number>)(
    async (tx) => {
      if (snapshot) await tx.$executeRawUnsafe(`LOCK TABLE ${order.map(q).join(', ')} IN SHARE MODE`);
      await tx.$executeRawUnsafe(`UPDATE "SyncState" SET "enabled" = true, "enabledAt" = now(), "lastError" = NULL WHERE "id" = 1`);
      let queued = 0;
      if (snapshot) {
        for (const name of order) {
          const t = tables.get(name)!;
          const key = `jsonb_build_object(${t.pk.map((c) => `'${c}', t.${q(c)}`).join(', ')})`;
          queued += await tx.$executeRawUnsafe(
            `INSERT INTO "SyncOutbox" ("tableName", "op", "key", "row") SELECT '${name}', 'U', ${key}, to_jsonb(t) FROM ${q(name)} t`,
          );
        }
      }
      return queued;
    },
    { isolationLevel: 'RepeatableRead', timeout: 600_000, maxWait: 30_000 },
  );
}

export async function disableCapture(owner: Raw) {
  await owner.$executeRawUnsafe(`UPDATE "SyncState" SET "enabled" = false WHERE "id" = 1`);
}

// --- Cloud: export (bootstrap a clinic server, data portability) -------------------------------

/** Every row of the current clinic, table by table, parents first. Run under row-level security. */
export async function* exportRows(tenantDb: Raw, tables: Tables): AsyncGenerator<{ table: string; row: string }> {
  for (const name of dependencyOrder(tables)) {
    const rows = await tenantDb.$queryRawUnsafe<{ r: string }[]>(`SELECT to_jsonb(t)::text AS r FROM ${q(name)} t`);
    for (const { r } of rows) yield { table: name, row: r };
  }
}

import { createPrismaClient, type Db } from '@hmis/db';
import { tenantContext } from '../common/tenant-context.js';
import {
  applyChanges,
  type Change,
  dependencyOrder,
  exportRows,
  loadTables,
  schemaVersion,
  type Tables,
} from '../sync/engine.js';

/**
 * A whole clinic as JSON lines, the same format a new clinic server is copied with:
 *   {"type":"meta","format":"hmis-clinic-export","version":"<schema>","tenantId":"…","clinic":"…","exportedAt":"…"}
 *   {"type":"row","table":"Patient","row":{…}}      every row of every clinic table, parents first
 *   {"type":"end","rows":1234}
 * Staff sign-in secrets are left out of an export (password hashes, two-step keys and recovery
 * codes): whoever gets the file cannot sign in as anyone. After an import, staff get new passwords.
 */
const SECRET_USER_FIELDS = {
  passwordHash: '',
  totpSecret: null,
  totpPendingSecret: null,
  totpLastStep: null,
  totpRecoveryCodes: [],
  mustChangePassword: true,
  temporaryPasswordExpiresAt: null,
};

export function withoutSecrets(table: string, row: string) {
  if (table !== 'User') return row;
  return JSON.stringify({
    ...(JSON.parse(row) as object),
    ...SECRET_USER_FIELDS,
  });
}

export async function* exportClinicLines(
  owner: Db,
  appDatabaseUrl: string,
  tenantId: string,
): AsyncGenerator<string> {
  const tenant = await owner.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true },
  });
  const tables = await loadTables(owner);
  // Its own connection, bound to this clinic under row-level security: nothing of any other clinic
  // can end up in the file, and the rows stream out table by table.
  const clinicDb = createPrismaClient(appDatabaseUrl, {
    tenant: () => tenantId,
  });
  try {
    await assertRowSecurity(clinicDb);
    yield `${JSON.stringify({ type: 'meta', format: 'hmis-clinic-export', version: await schemaVersion(owner), tenantId, clinic: tenant.name, exportedAt: new Date().toISOString() })}
`;
    let rows = 0;
    for await (const { table, row } of exportRows(clinicDb, tables)) {
      yield `{"type":"row","table":${JSON.stringify(table)},"row":${withoutSecrets(table, row)}}
`;
      rows++;
    }
    yield `${JSON.stringify({ type: 'end', rows })}
`;
  } finally {
    await clinicDb.$disconnect();
  }
}

export class ImportError extends Error {}

/**
 * Row-level security really applies to this connection (it is the restricted application role,
 * not the owner): otherwise an export would contain every clinic, and a deletion would empty
 * every clinic's tables.
 */
export async function assertRowSecurity(db: { $queryRawUnsafe: Db['$queryRawUnsafe'] }) {
  const [r] = await db.$queryRawUnsafe<{ on: boolean }[]>(`SELECT row_security_active('"Patient"') AS "on"`);
  if (!r?.on) throw new Error('Refused: row-level security is not active on this connection (is APP_DATABASE_URL the restricted hmis_app role?)');
}

/**
 * Loads a clinic from an export (or the cloud's copy, for a new clinic server) into this server,
 * under row-level security as that clinic, so it can only ever fill in that one clinic.
 */
export async function importClinicLines(
  owner: Db,
  appDatabaseUrl: string,
  lines: AsyncIterable<string>,
  opts: { onProgress?: (rows: number) => void; allowExisting?: boolean } = {},
) {
  let tenantId = '';
  const tenantDb = createPrismaClient(appDatabaseUrl, {
    tenant: () => tenantId,
  });
  const tables = await loadTables(owner);
  let batch: Change[] = [];
  let total = 0;
  let seq = 0;
  let ended = false;
  const flush = async () => {
    if (!batch.length) return;
    const changes = batch;
    batch = [];
    total += await tenantDb.$transaction(
      (tx) => applyChanges(tx, tables, changes),
      { timeout: 300_000 },
    );
    opts.onProgress?.(total);
  };
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as {
        type: string;
        tenantId?: string;
        version?: string;
        table?: string;
        row?: Record<string, unknown>;
        rows?: number;
      };
      if (msg.type === 'meta') {
        if (!msg.tenantId)
          throw new ImportError('This file has no clinic in it.');
        tenantId = msg.tenantId;
        const mine = await schemaVersion(owner);
        if ((msg.version ?? '') > mine)
          throw new ImportError(
            `The data comes from a newer HMIS (${msg.version}); this server is on ${mine}: update this server first.`,
          );
        if (
          !opts.allowExisting &&
          (await owner.tenant.findUnique({ where: { id: tenantId } }))
        )
          throw new ImportError('This clinic is already on this server.');
      } else if (msg.type === 'row') {
        if (!tenantId)
          throw new ImportError(
            'The file does not start with its description line.',
          );
        const t = tables.get(msg.table!);
        if (!t)
          throw new ImportError(
            `Unknown table ${msg.table}: update this server first.`,
          );
        const key = JSON.stringify(
          Object.fromEntries(t.pk.map((c) => [c, msg.row![c]])),
        );
        batch.push({
          seq: String(++seq),
          table: msg.table!,
          op: 'U',
          key,
          row: JSON.stringify(msg.row),
        });
        if (batch.length >= 500) await flush();
      } else if (msg.type === 'end') {
        await flush();
        if (msg.rows !== total)
          throw new ImportError(
            `Expected ${msg.rows} rows, loaded ${total}: the file is incomplete.`,
          );
        ended = true;
      }
    }
    if (!ended)
      throw new ImportError(
        'The data stopped before the end: the file is incomplete.',
      );
    return { tenantId, rows: total };
  } finally {
    await tenantDb.$disconnect();
  }
}

/** Lines of text from a stream of bytes. */
export async function* textLines(chunks: AsyncIterable<Uint8Array | string>) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of chunks) {
    buffer +=
      typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

/**
 * Deletes every record of a clinic (after it left HMIS and could export its data), children
 * first, as that clinic under row-level security. The clinic row itself stays (HMIS's invoices
 * refer to it), with nobody left who can sign in. Refuses to start if any table it would empty
 * is not protected by row-level security: that table would be emptied for every clinic.
 */
export async function deleteClinicData(
  owner: Db,
  client: Db,
  tenantId: string,
) {
  const tables: Tables = await loadTables(owner);
  const order = dependencyOrder(tables)
    .filter((t) => t !== 'Tenant')
    .reverse();
  const unprotected = await owner.$queryRawUnsafe<{ relname: string }[]>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1) AND NOT c.relrowsecurity`,
    order,
  );
  if (unprotected.length)
    throw new Error(
      `Not deleting: these tables have no row-level security: ${unprotected.map((u) => u.relname).join(', ')}`,
    );

  const counts: Record<string, number> = {};
  await tenantContext.run({ tenantId }, () =>
    client.$transaction(
      async (tx) => {
        await assertRowSecurity(tx);
        // The clinic this transaction can see must be exactly this one.
        const visible = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id" FROM "Tenant"`,
        );
        if (visible.length !== 1 || visible[0].id !== tenantId)
          throw new Error(
            'Not deleting: the clinic is not the only one visible.',
          );
        // Erasing the whole clinic removes its permanent records too (the stock ledger), for
        // this transaction only.
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.erasing_clinic', 'on', true)`,
        );
        for (const t of order) {
          const n = await tx.$executeRawUnsafe(
            `DELETE FROM "${t.replace(/"/g, '""')}"`,
          );
          if (n) counts[t] = n;
        }
      },
      { timeout: 600_000, maxWait: 30_000 },
    ),
  );
  // Kept apart from the clinic's data (not synced): delete them too.
  counts.DisplayScreen = (
    await owner.displayScreen.deleteMany({ where: { tenantId } })
  ).count;
  counts.IdempotentRequest = (
    await owner.idempotentRequest.deleteMany({ where: { tenantId } })
  ).count;
  return counts;
}

/**
 * A whole-database copy without pg_dump (app hosting has no PostgreSQL tools): every table of the
 * public schema, read in one consistent snapshot with COPY, as one stream of text ("hmis-dump-1").
 * The nightly backup gzips and encrypts it (nightly.ts); restoreDump() loads it back into a
 * database that has the same migrations applied.
 *
 *   {"format":"hmis-dump-1","createdAt":…,"database":…,"migrations":[…]}
 *   {"table":"Tenant","columns":["id",…]}
 *   <COPY text rows, one per line>
 *   \.
 *   … every table, parents before the tables that refer to them …
 *   {"end":true,"rows":{"Tenant":3,…},"sequences":{"SyncOutbox_seq_seq":42}}
 *
 * COPY's text format escapes newlines and backslashes inside values, so a line is always one row
 * and a line holding only "\." is always the end of a table.
 */
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import pg from 'pg';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';

export const DUMP_FORMAT = 'hmis-dump-1';
const END_OF_TABLE = '\\.';
/** Prisma's own bookkeeping: the target database gets it from `prisma migrate deploy`. */
const SKIP = new Set(['_prisma_migrations']);

export type DumpHeader = { format: string; createdAt: string; database: string; migrations: string[] };
export type DumpSummary = { header: DumpHeader; rows: Record<string, number>; totalRows: number; databaseBytes: number; sequences: Record<string, string> };

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function write(out: Writable, chunk: string | Buffer) {
  if (!out.write(chunk)) await once(out, 'drain');
}

/** The public tables, parents first (a table comes after every table its foreign keys point to). */
async function tablesInOrder(c: pg.Client) {
  const tables = (await c.query<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows
    .map((r) => r.name)
    .filter((t) => !SKIP.has(t));
  const fks = (
    await c.query<{ child: string; parent: string }>(
      `SELECT ch.relname AS child, pa.relname AS parent
         FROM pg_constraint k
         JOIN pg_class ch ON ch.oid = k.conrelid JOIN pg_namespace n ON n.oid = ch.relnamespace
         JOIN pg_class pa ON pa.oid = k.confrelid
        WHERE k.contype = 'f' AND n.nspname = 'public'`,
    )
  ).rows;
  const parents = new Map(tables.map((t) => [t, new Set<string>()]));
  // A table that refers to itself (Patient.mergedInto) loads in one COPY; the check runs at its end.
  for (const { child, parent } of fks) if (child !== parent && parents.has(child) && parents.has(parent)) parents.get(child)!.add(parent);
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...parents.get(t)!].every((p) => done.has(p)));
    if (!ready.length) throw new Error(`Foreign keys form a loop between: ${tables.filter((t) => !done.has(t)).join(', ')}`);
    for (const t of ready) {
      ordered.push(t);
      done.add(t);
    }
  }
  return ordered;
}

async function columnsOf(c: pg.Client, table: string) {
  return (
    await c.query<{ name: string }>(
      `SELECT a.attname AS name FROM pg_attribute a
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        ORDER BY a.attnum`,
      [`public.${ident(table)}`],
    )
  ).rows.map((r) => r.name);
}

async function appliedMigrations(c: pg.Client) {
  return (
    await c.query<{ name: string }>(
      `SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    )
  ).rows.map((r) => r.name);
}

/**
 * Writes the whole database to `out` (not ended: the caller ends it). Needs the owner connection
 * (DATABASE_URL): row-level security is not forced, so the owner sees every clinic.
 */
export async function dumpDatabase(url: string, out: Writable, opts: { client?: pg.Client } = {}): Promise<DumpSummary> {
  const c = opts.client ?? new pg.Client({ connectionString: url, application_name: 'hmis-backup' });
  if (!opts.client) await c.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const [{ database, bytes }] = (await c.query<{ database: string; bytes: string }>(`SELECT current_database() AS database, pg_database_size(current_database())::text AS bytes`)).rows;
    const header: DumpHeader = { format: DUMP_FORMAT, createdAt: new Date().toISOString(), database, migrations: await appliedMigrations(c) };
    await write(out, JSON.stringify(header) + '\n');

    const rows: Record<string, number> = {};
    for (const table of await tablesInOrder(c)) {
      const columns = await columnsOf(c, table);
      await write(out, JSON.stringify({ table, columns }) + '\n');
      let count = 0;
      const stream = c.query(copyTo(`COPY public.${ident(table)} (${columns.map(ident).join(', ')}) TO STDOUT`));
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, i + 1)) count++;
        await write(out, chunk);
      }
      await write(out, END_OF_TABLE + '\n');
      rows[table] = count;
    }

    const sequences: Record<string, string> = {};
    for (const s of (await c.query<{ name: string; value: string | null }>(`SELECT sequencename AS name, last_value::text AS value FROM pg_sequences WHERE schemaname = 'public'`)).rows) {
      if (s.value !== null) sequences[s.name] = s.value;
    }
    await write(out, JSON.stringify({ end: true, rows, sequences }) + '\n');
    await c.query('COMMIT');
    return { header, rows, totalRows: Object.values(rows).reduce((a, b) => a + b, 0), databaseBytes: Number(bytes), sequences };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    if (!opts.client) await c.end();
  }
}

export class DumpError extends Error {}

/**
 * Loads a dump (plain text, already decrypted and gunzipped) into the database at `url`,
 * REPLACING all of its data, in one transaction: on any problem nothing changes. The target must
 * have at least the dump's migrations (`prisma migrate deploy`) and the connection must own the
 * tables (DATABASE_URL). Triggers (sync capture, ledger guards) are paused while loading.
 */
export async function restoreDump(url: string, input: Readable): Promise<DumpSummary> {
  const c = new pg.Client({ connectionString: url, application_name: 'hmis-restore' });
  await c.connect();
  const lines = createInterface({ input, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const next = async () => {
    const r = await lines.next();
    if (r.done) throw new DumpError('The backup file ends too early: it is incomplete or damaged.');
    return r.value;
  };
  const json = <T>(line: string, what: string): T => {
    try {
      return JSON.parse(line) as T;
    } catch {
      throw new DumpError(`Not an HMIS backup, or damaged (expected ${what}).`);
    }
  };
  try {
    const header = json<DumpHeader>(await next(), 'the header');
    if (header.format !== DUMP_FORMAT) throw new DumpError(`Not an HMIS backup (format ${String(header.format)}).`);

    await c.query('BEGIN');
    const have = new Set(await appliedMigrations(c));
    const missing = header.migrations.filter((m) => !have.has(m));
    if (missing.length) {
      throw new DumpError(`The database is older than the backup: apply the migrations first (pnpm db:deploy). Missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
    }
    const tables = (await c.query<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`)).rows.map((r) => r.name).filter((t) => !SKIP.has(t));
    const list = tables.map((t) => `public.${ident(t)}`).join(', ');
    for (const t of tables) await c.query(`ALTER TABLE public.${ident(t)} DISABLE TRIGGER USER`);
    await c.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

    const rows: Record<string, number> = {};
    type End = { end: true; rows: Record<string, number>; sequences: Record<string, string> };
    let end: End | undefined;
    while (!end) {
      const line = await next();
      const section = json<{ table?: string; columns?: string[]; end?: true; rows?: Record<string, number>; sequences?: Record<string, string> }>(line, 'a table');
      if (section.end) {
        end = section as End;
        break;
      }
      const { table, columns } = section;
      if (!table || !columns || !tables.includes(table)) throw new DumpError(`The backup has a table this database does not: ${String(table)}.`);
      const copy = c.query(copyFrom(`COPY public.${ident(table)} (${columns.map(ident).join(', ')}) FROM STDIN`));
      const finished = new Promise<void>((resolve, reject) => {
        copy.on('finish', resolve);
        copy.on('error', reject);
      });
      let count = 0;
      for (let row = await next(); row !== END_OF_TABLE; row = await next()) {
        count++;
        await write(copy, row + '\n');
      }
      copy.end();
      await finished;
      rows[table] = count;
    }

    for (const [table, n] of Object.entries(end!.rows)) {
      if (rows[table] !== n) throw new DumpError(`Table ${table}: the backup lists ${n} rows but ${rows[table] ?? 0} were read. The file is damaged.`);
    }
    for (const [name, value] of Object.entries(end!.sequences ?? {})) {
      await c.query(`SELECT setval($1::regclass, $2::bigint)`, [`public.${ident(name)}`, value]);
    }
    for (const t of tables) await c.query(`ALTER TABLE public.${ident(t)} ENABLE TRIGGER USER`);
    await c.query('COMMIT');
    const [{ bytes }] = (await c.query<{ bytes: string }>(`SELECT pg_database_size(current_database())::text AS bytes`)).rows;
    return { header, rows, totalRows: Object.values(rows).reduce((a, b) => a + b, 0), databaseBytes: Number(bytes), sequences: end!.sequences ?? {} };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    input.destroy();
    await c.end();
  }
}

/**
 * The nightly backup (nightly.ts) from the command line: `node dist/backups/cli.js <command>`.
 *
 *   keygen <secret-key-file>
 *                     a new age key pair: the SECRET key is written to the file (keep it offline,
 *                     e.g. on two USB sticks and in the password manager; without it no backup can
 *                     be read) and the PUBLIC key is printed, for HMIS_BACKUP_RECIPIENT
 *   run               a backup now (HMIS_BACKUP_* settings, DATABASE_URL)
 *   list              the copies in the bucket
 *   download <key> [file]
 *                     one copy, still encrypted
 *   restore <file | s3:<key> | -> --identity <secret-key-file> --replace-all-data
 *                     REPLACES ALL DATA in the database at DATABASE_URL with the copy, in one
 *                     transaction (nothing changes on an error). The database must have the
 *                     copy's migrations first (pnpm db:deploy). A file ending in .age is
 *                     decrypted with the identity; "-" reads an already decrypted copy (e.g.
 *                     `age -d -i key.txt copy.age | node dist/backups/cli.js restore - …`).
 *       --test --record <url>
 *                     a restore drill into a scratch database: also records the passed test in
 *                     the live database at <url>, for Settings → Backups
 */
import 'dotenv/config';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Decrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { createPrismaClient } from '@hmis/db';
import { restoreDump } from './dump.js';
import { backupTime, NIGHTLY, nightlyFromEnv, runNightlyBackup } from './nightly.js';
import { S3Store, s3FromEnv } from './s3.js';

const [cmd, ...args] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const human = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function store() {
  const s3 = s3FromEnv();
  if (!s3) fail('Set the bucket: HMIS_BACKUP_S3_ENDPOINT, HMIS_BACKUP_S3_BUCKET, HMIS_BACKUP_S3_ACCESS_KEY, HMIS_BACKUP_S3_SECRET_KEY.');
  return { store: new S3Store(s3), prefix: nightlyFromEnv()?.prefix ?? process.env.HMIS_BACKUP_S3_PREFIX ?? 'hmis-backups/' };
}

async function keygen() {
  const file = args[0];
  if (!file) fail('usage: keygen <secret-key-file>');
  if (existsSync(file)) fail(`${file} exists: not overwritten.`);
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  await writeFile(file, `# HMIS backup key, created ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Secret key written to ${file}. Keep it offline and in two places: without it no backup can be read.`);
  console.log(`Public key (HMIS_BACKUP_RECIPIENT): ${recipient}`);
}

async function run() {
  const cfg = nightlyFromEnv();
  if (!cfg) fail('The nightly backup is not set up: HMIS_BACKUP_RECIPIENT and the HMIS_BACKUP_S3_* settings are needed.');
  const url = process.env.DATABASE_URL ?? fail('Set DATABASE_URL (the owner connection).');
  const db = createPrismaClient(url);
  try {
    const r = await runNightlyBackup(db, url, cfg);
    if (r.status === 'FAILED') fail(`Backup failed: ${r.error}`);
    if (r.status === 'SKIPPED') fail('Another backup is running.');
    console.log(`Backup ${r.key}: ${human(r.sizeBytes)}, ${r.totalRows} rows${r.deleted ? `, ${r.deleted} old copies removed` : ''}.`);
  } finally {
    await db.$disconnect();
  }
}

async function list() {
  const { store: s, prefix } = store();
  const objects = (await s.list(prefix)).sort((a, b) => a.key.localeCompare(b.key));
  if (!objects.length) console.log(`No copies in ${s.location}/${prefix}`);
  for (const o of objects) console.log(`${o.key}  ${human(o.size)}  ${backupTime(o.key)?.toISOString() ?? ''}`);
}

async function download() {
  const [key, file] = args;
  if (!key) fail('usage: download <key> [file]');
  const out = file ?? key.split('/').pop()!;
  if (existsSync(out)) fail(`${out} exists: not overwritten.`);
  await pipeline(await store().store.get(key), createWriteStream(out, { flags: 'wx' }));
  console.log(`Saved ${out} (still encrypted).`);
}

async function identityFrom(file: string) {
  const line = (await readFile(file, 'utf8')).split(/\r?\n/).find((l) => l.startsWith('AGE-SECRET-KEY-'));
  return line ?? fail(`${file} has no AGE-SECRET-KEY line.`);
}

async function restore() {
  const source = args[0];
  if (!source || source.startsWith('--')) fail('usage: restore <file | s3:<key> | -> --identity <secret-key-file> --replace-all-data');
  if (!flag('replace-all-data')) fail('Restoring REPLACES ALL DATA in the database at DATABASE_URL. Add --replace-all-data to go ahead.');
  const url = process.env.DATABASE_URL ?? fail('Set DATABASE_URL (the owner connection of the database to restore into).');
  const record = opt('record');
  if (flag('test') && !record) fail('--test needs --record <url of the live database>.');
  if (record && record === url) fail('--record must be the live database, not the one being restored into.');

  let input: Readable;
  let encrypted = false;
  if (source === '-') input = process.stdin;
  else if (source.startsWith('s3:')) {
    input = await store().store.get(source.slice(3));
    encrypted = source.endsWith('.age');
  } else {
    if (!existsSync(source)) fail(`${source} not found.`);
    input = createReadStream(source);
    encrypted = source.endsWith('.age');
  }
  if (encrypted) {
    const keyFile = opt('identity') ?? process.env.HMIS_BACKUP_IDENTITY_FILE ?? fail('The copy is encrypted: add --identity <secret-key-file>.');
    const d = new Decrypter();
    d.addIdentity(await identityFrom(keyFile));
    input = Readable.fromWeb((await d.decrypt(Readable.toWeb(input) as ReadableStream<Uint8Array>)) as never);
  }
  // Copies are gzipped inside the encryption; --plain for a copy already gunzipped by hand.
  const plain = flag('plain') ? input : input.pipe(createGunzip());

  const started = Date.now();
  const summary = await restoreDump(url, plain);
  const seconds = Math.round((Date.now() - started) / 1000);
  const name = source.split('/').pop();
  const msg = `Restored ${name} (copy of ${summary.header.createdAt.slice(0, 16).replace('T', ' ')} UTC): ${summary.totalRows} rows in ${Object.keys(summary.rows).length} tables, ${seconds} s.`;
  console.log(msg);

  const patients = summary.rows.Patient ?? 0;
  const visits = summary.rows.Visit ?? 0;
  const target = createPrismaClient(url);
  try {
    await target.backupEvent.create({
      data: { kind: 'RESTORE', status: 'OK', detail: NIGHTLY, message: msg, startedAt: new Date(started), data: { source: name, copyCreatedAt: summary.header.createdAt, rows: summary.totalRows } },
    });
  } finally {
    await target.$disconnect();
  }
  if (record) {
    const live = createPrismaClient(record);
    try {
      await live.backupEvent.create({
        data: {
          kind: 'RESTORE_TEST',
          status: 'OK',
          detail: NIGHTLY,
          message: `Restore drill: ${name} restored into a scratch database; every table's row count matched.`,
          startedAt: new Date(started),
          data: { recoverySeconds: seconds, patients, visits, rows: summary.totalRows },
        },
      });
      console.log('Recorded the passed restore test in the live database.');
    } finally {
      await live.$disconnect();
    }
  }
}

try {
  if (cmd === 'keygen') await keygen();
  else if (cmd === 'run') await run();
  else if (cmd === 'list') await list();
  else if (cmd === 'download') await download();
  else if (cmd === 'restore') await restore();
  else fail('usage: node dist/backups/cli.js keygen|run|list|download|restore (see the top of src/backups/cli.ts)');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

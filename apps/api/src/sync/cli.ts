/**
 * Sync setup, run on the server (node dist/sync/cli.js <command>). See README.md here.
 *
 * On the cloud:
 *   token create <tenantId> "<server name>" [--new]
 *                                            issue a clinic server's sync token (shown once); the
 *                                            clinic's cloud copy becomes read-only. --new: the clinic
 *                                            so far ran only on its server (creates its placeholder)
 *   token list [tenantId]                     tokens and when each server last called in
 *   token revoke <tokenId>                    stop accepting a server; the cloud copy is editable again
 *
 * On a clinic server (DATABASE_URL, APP_DATABASE_URL, SYNC_CLOUD_URL, SYNC_TOKEN set):
 *   bootstrap                                 copy the clinic from the cloud into this empty server
 *   enable [--snapshot]                       start capturing changes (--snapshot: also queue all
 *                                            existing rows, for a cloud that has never seen them)
 *   disable                                   stop capturing changes
 *   status                                    capture state and how many changes wait to be sent
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createPrismaClient } from '@hmis/db';
import { importClinicLines, textLines } from '../exports/clinic-data.js';
import { disableCapture, enableCapture, hashToken } from './engine.js';

const [cmd, sub, ...rest] = process.argv.slice(2);
const owner = createPrismaClient(process.env.DATABASE_URL);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function token() {
  if (sub === 'create') {
    const [tenantId, name, flag] = rest;
    if (!tenantId || !name) fail('usage: token create <tenantId> "<server name>" [--new]');
    let tenant = await owner.tenant.findUnique({ where: { id: tenantId } });
    // --new: a clinic that so far ran only on its clinic server. A placeholder holds its place
    // until the server's first full copy (`enable --snapshot` there) fills in the real clinic.
    if (!tenant && flag === '--new') tenant = await owner.tenant.create({ data: { id: tenantId, name: '(waiting for the clinic server)' } });
    if (!tenant) fail(`No clinic with id ${tenantId} (add --new for a clinic that so far ran only on its clinic server)`);
    const secret = randomBytes(32).toString('base64url');
    const client = await owner.syncClient.create({ data: { tenantId, name, tokenHash: hashToken(secret) } });
    console.log(`Clinic server "${name}" for ${tenant.name} (token id ${client.id}).`);
    console.log(`Its cloud copy is read-only from now on. Put this in the clinic server's environment (shown once):`);
    console.log(`SYNC_TOKEN=${secret}`);
  } else if (sub === 'list') {
    const clients = await owner.syncClient.findMany({ where: rest[0] ? { tenantId: rest[0] } : {}, orderBy: { createdAt: 'asc' } });
    for (const c of clients) {
      console.log(
        [c.id, c.tenantId, c.name, c.revokedAt ? `revoked ${c.revokedAt.toISOString()}` : 'active', `last seen ${c.lastSeenAt?.toISOString() ?? 'never'}`, `${c.appliedRows} rows`, c.lastError ?? ''].join('  '),
      );
    }
  } else if (sub === 'revoke') {
    if (!rest[0]) fail('usage: token revoke <tokenId>');
    await owner.syncClient.update({ where: { id: rest[0] }, data: { revokedAt: new Date() } });
    console.log('Revoked. If it was the clinic\'s only server, its cloud copy is editable again (within 15 seconds).');
  } else {
    fail('usage: token create|list|revoke');
  }
}

async function bootstrap() {
  const url = process.env.SYNC_CLOUD_URL;
  const secret = process.env.SYNC_TOKEN;
  const appUrl = process.env.APP_DATABASE_URL;
  if (!url || !secret || !appUrl) fail('Set SYNC_CLOUD_URL, SYNC_TOKEN and APP_DATABASE_URL first.');
  if ((await owner.tenant.count()) > 0 && sub !== '--force') fail('This database already has clinic data. Bootstrap only fills an empty server.');
  await disableCapture(owner); // the cloud already has all of this

  const res = await fetch(`${url.replace(/\/+$/, '')}/sync/export`, { headers: { authorization: `Bearer ${secret}` } });
  if (!res.ok || !res.body) fail(`The cloud refused the export: ${res.status} ${await res.text()}`);
  try {
    // The same loading as an export file (exports/clinic-data.ts), under row-level security as that clinic.
    const { rows } = await importClinicLines(owner, appUrl, textLines(res.body as unknown as AsyncIterable<Uint8Array>), {
      allowExisting: true,
      onProgress: (n) => process.stdout.write(`\r${n} rows`),
    });
    await enableCapture(owner, { snapshot: false });
    console.log(`\nCopied ${rows} rows of the clinic. Capture is on: changes made here now go to the cloud.`);
  } catch (e) {
    fail(`\n${e instanceof Error ? e.message : e} Run bootstrap again with --force.`);
  }
}

async function status() {
  const state = await owner.syncState.findUnique({ where: { id: 1 } });
  const [w] = await owner.$queryRawUnsafe<{ n: bigint; oldest: Date | null }[]>(`SELECT count(*) AS n, min("at") AS oldest FROM "SyncOutbox"`);
  console.log(`Capture:   ${state?.enabled ? `on since ${state.enabledAt?.toISOString()}` : 'off'}`);
  console.log(`Cloud:     ${process.env.SYNC_CLOUD_URL ?? '(SYNC_CLOUD_URL not set)'}`);
  console.log(`Last sent: ${state?.lastPushAt?.toISOString() ?? 'never'}, ${state?.pushedRows ?? 0} changes in total`);
  console.log(`Waiting:   ${w?.n ?? 0} changes${w?.oldest ? `, oldest from ${w.oldest.toISOString()}` : ''}`);
  if (state?.lastError) console.log(`Problem:   ${state.lastError} (${state.lastErrorAt?.toISOString()})`);
}

try {
  if (cmd === 'token') await token();
  else if (cmd === 'bootstrap') await bootstrap();
  else if (cmd === 'enable') console.log(`Capture is on${sub === '--snapshot' ? `; ${await enableCapture(owner, { snapshot: true })} existing rows queued for the cloud` : ''}.`);
  else if (cmd === 'disable') {
    await disableCapture(owner);
    console.log('Capture is off. Changes made from now on stay on this server only.');
  } else if (cmd === 'status') await status();
  else fail('usage: node dist/sync/cli.js token|bootstrap|enable|disable|status (see the top of src/sync/cli.ts)');
} finally {
  await owner.$disconnect();
}

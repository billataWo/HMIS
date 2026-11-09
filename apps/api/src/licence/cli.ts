/**
 * HMIS licences, on the server: `node dist/licence/cli.js <command>` (or `deploy/hmis licence ...`).
 *
 *   keygen                HMIS only, once, on an offline computer: the licence-signing key pair.
 *                         The public key goes into apps/api/src/licence/public-key.ts; the private
 *                         key only into the HMIS cloud's deploy/.env (HMIS_LICENCE_PRIVATE_KEY).
 *   status                the licence installed on this server, and what it allows
 *   install <file>        installs a licence file from HMIS (an own-server install); - reads it
 *                         from standard input (deploy/hmis licence install <file> does that)
 */
import 'dotenv/config';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPrismaClient } from '@hmis/db';
import { installLicence, licencePublicKey, licenceRequired, licenceState, readLicence } from './licence.js';

const [cmd, arg] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (cmd === 'keygen') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  console.log('Public key: into apps/api/src/licence/public-key.ts (BUILT_IN_LICENCE_PUBLIC_KEY), then rebuild:\n');
  console.log(publicKey);
  console.log('Private key: ONLY into the HMIS cloud\'s deploy/.env, on one line, and a printed copy in the safe:\n');
  console.log(`HMIS_LICENCE_PRIVATE_KEY="${privateKey.trim().replace(/\n/g, '\\n')}"`);
  process.exit(0);
}

const db = createPrismaClient(process.env.DATABASE_URL);
try {
  if (cmd === 'status') {
    console.log(`Licence key:  ${licencePublicKey() ? 'present' : 'MISSING (licences cannot be checked)'}`);
    console.log(`Required:     ${licenceRequired() ? 'yes (HMIS_LICENCE=required)' : 'no'}`);
    const installed = await db.installedLicence.findMany();
    if (!installed.length) console.log('Installed:    none');
    for (const i of installed) {
      const read = readLicence(i.licence);
      if (!read.ok) {
        console.log(`Installed:    INVALID for clinic ${i.tenantId}: ${read.reason}`);
        continue;
      }
      const l = read.licence;
      const st = licenceState(l);
      console.log(`Installed:    ${l.clinicName}: ${l.plan.name}, ${st.state}${st.readOnly ? ' (read-only)' : ''}, until ${l.endsAt.slice(0, 10)} + ${l.graceDays} days' grace`);
      console.log(`              issued ${l.issuedAt.slice(0, 16).replace('T', ' ')}, ${i.source === 'sync' ? 'renewed through sync' : 'installed from a file'}`);
    }
  } else if (cmd === 'install') {
    if (!arg) fail('usage: install <licence file>');
    const { licence, changed } = await installLicence(db, readFileSync(arg === '-' ? 0 : arg, 'utf8'), 'upload');
    console.log(changed ? `Installed: ${licence.clinicName}, ${licence.plan.name}, until ${licence.endsAt.slice(0, 10)}.` : 'This licence is already installed.');
  } else {
    fail('usage: node dist/licence/cli.js keygen|status|install <file>');
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  await db.$disconnect();
}

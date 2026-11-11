import { hashPassword, temporaryPasswordExpiry } from '../common/passwords.js';
/**
 * Platform operators (HMIS staff who use the platform console), on the HMIS cloud server:
 * `node dist/platform/cli.js <command>`, or `deploy/hmis platform <command>`.
 *
 *   add-operator --name "<full name>" --email <email> [--role OWNER|BILLING|SUPPORT]
 *                     a new operator (OWNER if it is the first), with a temporary password shown
 *                     once; they set their password and two-step sign-in at the first sign-in
 *   list              the operators
 *   reset <email>     a new temporary password, and two-step sign-in set up again (lost phone)
 *   first-owner --email <email> [--name "<full name>"]
 *                     for hosts without a shell (AletCloud), on every start: with no operators,
 *                     creates this owner; while this owner has never signed in, gives a new
 *                     temporary password (so a password that scrolled out of the logs is not
 *                     lost). Once they have signed in, it does nothing.
 */
import 'dotenv/config';
import { createPrismaClient, type PlatformRole } from '@hmis/db';
import { temporaryPassword } from './create-clinic.js';

const [cmd, ...args] = process.argv.slice(2);
const owner = createPrismaClient(process.env.DATABASE_URL);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1].trim() : undefined;
};

async function add() {
  const fullName = opt('name');
  const email = opt('email')?.toLowerCase();
  if (!fullName || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('usage: add-operator --name "<full name>" --email <email> [--role OWNER|BILLING|SUPPORT]');
  const first = (await owner.platformUser.count()) === 0;
  const role = (opt('role')?.toUpperCase() ?? (first ? 'OWNER' : 'SUPPORT')) as PlatformRole;
  if (!['OWNER', 'BILLING', 'SUPPORT'].includes(role)) fail('--role must be OWNER, BILLING or SUPPORT');
  if (await owner.platformUser.findUnique({ where: { email } })) fail(`An operator with email ${email} exists (use: reset ${email}).`);
  const password = temporaryPassword();
  const op = await owner.platformUser.create({ data: { fullName, email, role, passwordHash: await hashPassword(password), temporaryPasswordExpiresAt: temporaryPasswordExpiry() } });
  await owner.platformAuditLog.create({ data: { action: 'operator.created', entity: 'PlatformUser', entityId: op.id, data: { by: 'server command line', email, role } } });
  console.log(`Operator ${fullName} (${role}).`);
  console.log(`  Sign in at:         ${process.env.HMIS_PUBLIC_URL?.replace(/\/+$/, '') || 'https://<this server>'}/platform/login`);
  console.log(`  Email:              ${email}`);
  console.log(`  Temporary password: ${password}`);
  console.log('At the first sign-in they choose a password (12+ characters) and set up two-step sign-in.');
}

async function firstOwner() {
  const email = opt('email')?.toLowerCase();
  if (!email) fail('usage: first-owner --email <email> [--name "<full name>"]');
  const count = await owner.platformUser.count();
  const existing = await owner.platformUser.findUnique({ where: { email } });
  if (count > 0 && !(existing && existing.role === 'OWNER' && !existing.lastSignInAt)) {
    console.log(existing?.lastSignInAt ? `Platform console: ${email} has signed in; nothing to do (remove HMIS_FIRST_OPERATOR_EMAIL).` : 'Platform console: operators exist; nothing to do.');
    return;
  }
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const op = existing
    ? await owner.platformUser.update({ where: { id: existing.id }, data: { passwordHash, mustChangePassword: true, temporaryPasswordExpiresAt: temporaryPasswordExpiry(), active: true, sessionsValidAfter: new Date() } })
    : await owner.platformUser.create({ data: { fullName: opt('name') || 'HMIS owner', email, role: 'OWNER', passwordHash, temporaryPasswordExpiresAt: temporaryPasswordExpiry() } });
  await owner.platformAuditLog.create({
    data: { action: existing ? 'operator.reset' : 'operator.created', entity: 'PlatformUser', entityId: op.id, data: { by: 'server start (first owner)', email } },
  });
  const url = `${process.env.HMIS_PUBLIC_URL?.replace(/\/+$/, '') || 'https://<this server>'}/platform/login`;
  console.log('==================== HMIS PLATFORM CONSOLE: FIRST SIGN-IN ====================');
  console.log(`  Sign in at:         ${url}`);
  console.log(`  Email:              ${email}`);
  console.log(`  Temporary password: ${password}`);
  console.log('  A new one is shown at every start until you have signed in. Then choose your own');
  console.log('  password and set up two-step sign-in, and remove HMIS_FIRST_OPERATOR_EMAIL.');
  console.log('================================================================================');
}

async function list() {
  const ops = await owner.platformUser.findMany({ orderBy: { fullName: 'asc' } });
  if (!ops.length) console.log('No operators yet: add-operator --name "..." --email ...');
  for (const o of ops) {
    console.log([o.email, o.fullName, o.role, o.active ? 'active' : 'inactive', o.totpEnabledAt ? 'two-step on' : 'two-step not set up', `last sign-in ${o.lastSignInAt?.toISOString() ?? 'never'}`].join('  '));
  }
}

async function reset() {
  const email = args[0]?.toLowerCase();
  if (!email) fail('usage: reset <email>');
  const op = await owner.platformUser.findUnique({ where: { email } });
  if (!op) fail(`No operator with email ${email}`);
  const password = temporaryPassword();
  await owner.platformUser.update({
    where: { id: op.id },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      temporaryPasswordExpiresAt: temporaryPasswordExpiry(),
      active: true,
      sessionsValidAfter: new Date(),
      totpSecret: null,
      totpPendingSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      totpRecoveryCodes: [],
    },
  });
  await owner.platformAuditLog.create({ data: { action: 'operator.reset', entity: 'PlatformUser', entityId: op.id, data: { by: 'server command line' } } });
  console.log(`${op.fullName}: temporary password ${password}. Their sign-ins have ended; they set up two-step sign-in again.`);
}

try {
  if (cmd === 'add-operator') await add();
  else if (cmd === 'list') await list();
  else if (cmd === 'reset') await reset();
  else if (cmd === 'first-owner') await firstOwner();
  else fail('usage: node dist/platform/cli.js add-operator|list|reset|first-owner (see the top of src/platform/cli.ts)');
} finally {
  await owner.$disconnect();
}

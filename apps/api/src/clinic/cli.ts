import { hashPassword, temporaryPasswordExpiry } from '../common/passwords.js';
/**
 * Clinic setup, run on the server (in the API container: `node dist/clinic/cli.js <command>`,
 * or `deploy/hmis clinic <command>`). Uses the owner connection (DATABASE_URL).
 *
 *   create --name "<clinic>" --admin-name "<full name>" --admin-phone <phone>
 *          [--name-am "<Amharic name>"] [--type CLINIC|PHARMACY|HOSPITAL] [--phone <clinic phone>]
 *          [--address "<address>"] [--no-starter] [--plan BASIC|STANDARD|... [--trial-days 30]]
 *                     a new clinic, its first admin (temporary password, shown once) and the
 *                     starter price list (--no-starter: an empty one). On the HMIS cloud, --plan
 *                     bills it as a service, starting with a free trial (usually the clinic comes
 *                     from a request approved in the platform console instead). --licence <file>:
 *                     an own-server install, created from its HMIS licence (the name comes from it)
 *   list              the clinics on this server
 *   reset-admin <phone> [--clinic <clinic id>]
 *                     a new temporary password for an admin who is locked out and has no other
 *                     admin to reset it (also ends their sign-ins and resets two-step sign-in)
 *   reset-admin-at-start <phone | clinic name>
 *                     for hosts without a shell, on every start while HMIS_RESET_CLINIC_ADMIN is
 *                     set: a new temporary password for that admin (two-step sign-in is kept),
 *                     until they sign in
 *   import <file|->    a clinic from an HMIS export (Settings → Data on its old server), e.g. moving
 *                     from the HMIS cloud to the clinic's own server. Staff passwords are not in
 *                     exports: each admin gets a new one (reset-admin), then resets the others
 */
import 'dotenv/config';
import { createPrismaClient, type FacilityType } from '@hmis/db';
import { normalizePhone } from '../common/phone.js';
import {
  createReadStream,
  openSync,
  readFileSync,
  readSync,
  closeSync,
} from 'node:fs';
import { createGunzip } from 'node:zlib';
import {
  ImportError,
  importClinicLines,
  textLines,
} from '../exports/clinic-data.js';
import { installLicence, readLicence } from '../licence/licence.js';
import { createClinic, temporaryPassword } from '../platform/create-clinic.js';

const [cmd, ...args] = process.argv.slice(2);
const owner = createPrismaClient(process.env.DATABASE_URL);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** `--key value` pairs and bare `--flag`s; positional arguments are left in `_`. */
function parse(list: string[]) {
  const out: Record<string, string | true> & { _: string[] } = {
    _: [],
  } as never;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (i + 1 < list.length && !list[i + 1].startsWith('--'))
      out[a.slice(2)] = list[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}
const text = (v: string | true | undefined) =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const USAGE_CREATE =
  'usage: create --name "<clinic>" --admin-name "<full name>" --admin-phone <phone> [--name-am ...] [--type CLINIC|PHARMACY|HOSPITAL] [--phone ...] [--address ...] [--no-starter] [--plan CODE [--trial-days N]] [--licence <file>]';

async function create() {
  const o = parse(args);
  // An own-server install: the clinic is created from its HMIS licence, with the same id as in the
  // HMIS cloud, and the licence installed.
  const licenceFile = text(o.licence);
  let licenceText: string | undefined;
  let licence: { tenantId: string; clinicName: string } | undefined;
  if (licenceFile) {
    licenceText = readFileSync(licenceFile === '-' ? 0 : licenceFile, 'utf8');
    const read = readLicence(licenceText);
    if (!read.ok) fail(read.reason);
    licence = read.licence;
  }
  const name = text(o.name) ?? licence?.clinicName;
  const adminName = text(o['admin-name']);
  const adminPhone = text(o['admin-phone']);
  if (!name || !adminName || !adminPhone) {
    fail(USAGE_CREATE);
  }
  const type = (text(o.type) ?? 'CLINIC').toUpperCase();
  if (!['CLINIC', 'PHARMACY', 'HOSPITAL'].includes(type))
    fail(`Unknown --type ${type}: CLINIC, PHARMACY or HOSPITAL.`);
  const planCode = text(o.plan)?.toUpperCase();
  const trialDays = Number(text(o['trial-days']) ?? 30);
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365)
    fail('--trial-days must be a whole number of days (0-365).');

  let created;
  try {
    created = await createClinic(owner, {
      ...(licence && { id: licence.tenantId }),
      name,
      nameAm: text(o['name-am']),
      type: type as FacilityType,
      phone: text(o.phone),
      address: text(o.address),
      adminName,
      adminPhone,
      starter: o['no-starter'] !== true,
      ...(planCode && { subscription: { planCode, trialDays } }),
    });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  const { tenant, adminPhone: phone, password } = created;
  if (licenceText) await installLicence(owner, licenceText, 'upload');
  await owner.auditLog.create({
    data: {
      tenantId: tenant.id,
      action: 'clinic.created',
      entity: 'Tenant',
      entityId: tenant.id,
      data: { by: 'server command line', plan: planCode ?? null },
    },
  });

  console.log(`Clinic "${tenant.name}" is ready (id ${tenant.id}).`);
  console.log('');
  console.log(`  Admin:              ${adminName}`);
  console.log(`  Sign in with phone: ${phone}`);
  console.log(`  Temporary password: ${password}`);
  if (planCode)
    console.log(
      `  Subscription:       ${planCode}, free trial for ${trialDays} days`,
    );
  console.log('');
  console.log(
    'Give the password to the admin in person (it is shown only now). At the first sign-in they',
  );
  console.log(
    'choose their own password and set up two-step sign-in with an authenticator app.',
  );
  if (o['no-starter'] !== true)
    console.log(
      'A starter price list was added: review it in Settings → Prices.',
    );
}

async function list() {
  const clinics = await owner.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { users: true, patients: true } } },
  });
  if (!clinics.length)
    console.log(
      'No clinics yet. Create one with: create --name ... --admin-name ... --admin-phone ...',
    );
  for (const c of clinics)
    console.log(
      [
        c.id,
        c.name,
        c.type,
        `${c._count.users} staff`,
        `${c._count.patients} patients`,
      ].join('  '),
    );
}

async function resetAdmin() {
  const o = parse(args);
  const phone = o._[0]
    ? normalizePhone(o._[0])
    : fail('usage: reset-admin <phone> [--clinic <clinic id>]');
  const admins = await owner.user.findMany({
    where: {
      phone,
      role: 'ADMIN',
      ...(text(o.clinic) ? { tenantId: text(o.clinic) } : {}),
    },
    include: { tenant: true },
  });
  if (!admins.length)
    fail(
      `No admin with phone ${phone}${text(o.clinic) ? ' in that clinic' : ''}.`,
    );
  if (admins.length > 1)
    fail(
      `That phone is an admin in ${admins.length} clinics: add --clinic <id> (see "list").`,
    );
  const [admin] = admins;
  const password = temporaryPassword();
  await owner.user.update({
    where: { id: admin.id },
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
  await owner.auditLog.create({
    data: {
      tenantId: admin.tenantId,
      userId: admin.id,
      action: 'user.admin_reset',
      entity: 'User',
      entityId: admin.id,
      data: { by: 'server command line' },
    },
  });
  console.log(
    `${admin.fullName} (${admin.tenant.name}): temporary password ${password}`,
  );
  console.log(
    'Their other sign-ins have ended; at the next sign-in they choose a password and set up two-step sign-in again.',
  );
}

/**
 * For hosts without a shell (AletCloud), on every start while HMIS_RESET_CLINIC_ADMIN is set: a
 * locked-out clinic admin, named by phone or by the clinic's name (when the clinic has one active
 * admin). Resets once, then again only if that admin has not signed in since the last start-up
 * reset, so a restart after they sign in does not lock them out again. Two-step sign-in is kept.
 */
async function resetAdminAtStart() {
  const target = args.join(' ').trim();
  if (!target) fail('usage: reset-admin-at-start <admin phone | clinic name>');
  const phone = normalizePhone(target);
  let admins = /^0[79]\d{8}$/.test(phone)
    ? await owner.user.findMany({ where: { phone, role: 'ADMIN' }, include: { tenant: true } })
    : await owner.user.findMany({
        where: { role: 'ADMIN', active: true, tenant: { name: { equals: target, mode: 'insensitive' } } },
        include: { tenant: true },
      });
  if (admins.length !== 1) {
    console.log(
      admins.length
        ? `Clinic admin reset: "${target}" matches ${admins.length} admins; set HMIS_RESET_CLINIC_ADMIN to one phone. Nothing was changed.`
        : `Clinic admin reset: no admin matches "${target}" (a phone, or a clinic's exact name). Nothing was changed.`,
    );
    if (!admins.length) admins = await owner.user.findMany({ where: { role: 'ADMIN' }, include: { tenant: true }, orderBy: { createdAt: 'asc' } });
    for (const a of admins) console.log(`  ${a.phone}  ${a.fullName}  (${a.tenant.name})${a.active ? '' : '  inactive'}`);
    return;
  }
  const [admin] = admins;
  const last = await owner.auditLog.findFirst({
    where: { tenantId: admin.tenantId, entityId: admin.id, action: 'user.admin_reset', data: { path: ['by'], equals: 'server start (reset)' } },
    orderBy: { createdAt: 'desc' },
  });
  if (last) {
    const signedIn = await owner.auditLog.findFirst({ where: { tenantId: admin.tenantId, userId: admin.id, action: 'auth.login', createdAt: { gt: last.createdAt } } });
    if (signedIn) {
      console.log(`Clinic admin reset: ${admin.fullName} (${admin.tenant.name}) has signed in since the reset; nothing to do (remove HMIS_RESET_CLINIC_ADMIN).`);
      return;
    }
  }
  const password = temporaryPassword();
  await owner.user.update({
    where: { id: admin.id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true, temporaryPasswordExpiresAt: temporaryPasswordExpiry(), active: true, sessionsValidAfter: new Date() },
  });
  await owner.auditLog.create({
    data: { tenantId: admin.tenantId, userId: admin.id, action: 'user.admin_reset', entity: 'User', entityId: admin.id, data: { by: 'server start (reset)' } },
  });
  console.log('======================= HMIS CLINIC ADMIN: PASSWORD RESET =======================');
  console.log(`  Sign in at:         ${process.env.HMIS_PUBLIC_URL?.replace(/\/+$/, '') || 'https://<this server>'}/login`);
  console.log(`  Clinic:             ${admin.tenant.name}`);
  console.log(`  Admin:              ${admin.fullName}`);
  console.log(`  Phone:              ${admin.phone}`);
  console.log(`  Temporary password: ${password}`);
  console.log('  A new one is shown at every start until they sign in. Then they choose their own');
  console.log('  password; remove HMIS_RESET_CLINIC_ADMIN.');
  console.log('===================================================================================');
}

/** Is the file gzip-compressed (an export as downloaded), or plain JSON lines? */
function gzipped(file: string) {
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(2);
  readSync(fd, head, 0, 2, 0);
  closeSync(fd);
  return head[0] === 0x1f && head[1] === 0x8b;
}

async function importFile() {
  const file = args[0];
  if (!file)
    fail('usage: import <export file> (or - to read it from standard input)');
  const appUrl = process.env.APP_DATABASE_URL;
  if (!appUrl)
    fail('Set APP_DATABASE_URL (the restricted hmis_app role) first.');
  const capture = await owner.syncState.findUnique({ where: { id: 1 } });
  if (capture?.enabled)
    fail(
      'This server sends its changes to the cloud (sync is on): importing another clinic here is not possible.',
    );
  const raw = file === '-' ? process.stdin : createReadStream(file);
  const stream = file === '-' || gzipped(file) ? raw.pipe(createGunzip()) : raw;
  let result;
  try {
    result = await importClinicLines(owner, appUrl, textLines(stream), {
      onProgress: (n) => process.stdout.write(`\r${n} rows`),
    });
  } catch (e) {
    fail(
      e instanceof ImportError || e instanceof Error
        ? `\n${e.message}`
        : String(e),
    );
  }
  const tenant = await owner.tenant.findUniqueOrThrow({
    where: { id: result.tenantId },
  });
  const admins = await owner.user.findMany({
    where: { tenantId: tenant.id, role: 'ADMIN', active: true },
    select: { fullName: true, phone: true },
  });
  console.log(`\nImported ${tenant.name}: ${result.rows} records.`);
  console.log(
    'Staff passwords and two-step keys are never in an export. Give an admin a new password:',
  );
  for (const a of admins)
    console.log(
      `  deploy/hmis clinic reset-admin ${a.phone}     (${a.fullName})`,
    );
  console.log('then the admin gives the other staff new passwords in Staff.');
}

try {
  if (cmd === 'create') await create();
  else if (cmd === 'import') await importFile();
  else if (cmd === 'list') await list();
  else if (cmd === 'reset-admin') await resetAdmin();
  else if (cmd === 'reset-admin-at-start') await resetAdminAtStart();
  else
    fail(
      'usage: node dist/clinic/cli.js create|list|reset-admin|import (see the top of src/clinic/cli.ts)',
    );
} finally {
  await owner.$disconnect();
}

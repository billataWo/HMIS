import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Db } from '@hmis/db';
import { type SubscriptionDates, subscriptionState } from '../platform/subscription-state.js';
import { BUILT_IN_LICENCE_PUBLIC_KEY } from './public-key.js';

const DAY = 86_400_000;
const PREFIX = 'HMIS-LICENCE-1';

/**
 * An HMIS licence: what the cloud knows about a clinic's subscription, signed by HMIS (Ed25519),
 * for servers that run the clinic outside the cloud. The server works out trial / active /
 * overdue / read-only from these dates exactly as the cloud does.
 */
export interface Licence {
  v: 1;
  id: string;
  tenantId: string;
  clinicName: string;
  plan: { code: string; name: string; maxStaff: number | null; features: string[] };
  deployment: 'CLOUD' | 'CLINIC_SERVER' | 'ON_PREMISE';
  status: 'TRIAL' | 'ACTIVE' | 'CANCELLED';
  /** End of the trial or the paid period. A clinic with no end date gets a year at a time. */
  endsAt: string;
  graceDays: number;
  /** Suspended by HMIS when the licence was issued. */
  suspended: boolean;
  issuedAt: string;
}

const pem = (v: string) => v.replace(/\\n/g, '\n');
export const licencePublicKey = () => {
  const key = process.env.HMIS_LICENCE_PUBLIC_KEY || BUILT_IN_LICENCE_PUBLIC_KEY;
  return key ? pem(key) : null;
};
export const licencePrivateKey = () => (process.env.HMIS_LICENCE_PRIVATE_KEY ? pem(process.env.HMIS_LICENCE_PRIVATE_KEY) : null);

/**
 * Why this server cannot issue licences, or null if it can. The private key must be the pair of
 * the public key the servers check against: a key from another pair signs licences that every
 * server refuses.
 */
export function licenceSigningProblem(): string | null {
  const privateKey = licencePrivateKey();
  if (!privateKey) return 'HMIS_LICENCE_PRIVATE_KEY is not set';
  const publicKey = licencePublicKey();
  if (!publicKey) return 'this server has no licence public key';
  try {
    const derived = createPublicKey(createPrivateKey(privateKey)).export({ type: 'spki', format: 'der' });
    const expected = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
    return derived.equals(expected) ? null : 'HMIS_LICENCE_PRIVATE_KEY is not the pair of the licence public key';
  } catch {
    return 'HMIS_LICENCE_PRIVATE_KEY cannot be read';
  }
}
/** Servers installed as clinic servers or own-server installs must have a licence. */
export const licenceRequired = () => process.env.HMIS_LICENCE === 'required';

/** The licence as text: a prefix, the payload and its signature (base64url), on one line. */
export function signLicence(licence: Licence, privateKeyPem: string) {
  const payload = Buffer.from(JSON.stringify(licence)).toString('base64url');
  const signature = sign(null, Buffer.from(`${PREFIX}.${payload}`), createPrivateKey(privateKeyPem)).toString('base64url');
  return `${PREFIX}.${payload}.${signature}`;
}

/** The licence inside the text, if HMIS signed it; otherwise why not. */
export function readLicence(text: string, publicKeyPem = licencePublicKey()): { ok: true; licence: Licence } | { ok: false; reason: string } {
  if (!publicKeyPem) return { ok: false, reason: "This server does not have HMIS's licence key." };
  const parts = text.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'This is not an HMIS licence file.' };
  let valid = false;
  try {
    valid = verify(null, Buffer.from(`${PREFIX}.${parts[1]}`), createPublicKey(publicKeyPem), Buffer.from(parts[2], 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'This licence was not issued by HMIS, or it has been changed.' };
  try {
    const licence = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Licence;
    if (licence.v !== 1 || !licence.tenantId || !licence.endsAt || !licence.issuedAt) return { ok: false, reason: 'This licence is incomplete.' };
    return { ok: true, licence };
  } catch {
    return { ok: false, reason: 'This licence cannot be read.' };
  }
}

/** The dates the subscription rules work from. */
export function licenceDates(l: Licence): SubscriptionDates {
  const ends = new Date(l.endsAt);
  return {
    status: l.status,
    trialEndsAt: l.status === 'TRIAL' ? ends : null,
    paidUntil: l.status === 'TRIAL' ? null : ends,
    graceDays: l.graceDays,
    suspendedAt: l.suspended ? new Date(l.issuedAt) : null,
    cancelledAt: l.status === 'CANCELLED' ? new Date(l.issuedAt) : null,
  };
}

export const licenceState = (l: Licence, now = new Date()) => subscriptionState(licenceDates(l), now);

/**
 * On the HMIS cloud: a licence for a clinic, from its subscription now. A synced clinic server
 * fetches a new one every hour; an own-server install gets the file from the platform console.
 */
export async function issueLicence(db: Db, tenantId: string, now = new Date()) {
  const problem = licenceSigningProblem();
  if (problem) throw new ConflictException(`Licences cannot be issued: ${problem}.`);
  const key = licencePrivateKey() as string;
  const sub = await db.subscription.findUnique({ where: { tenantId }, include: { plan: true, tenant: { select: { name: true } } } });
  if (!sub) throw new ConflictException('This clinic has no subscription');
  const ends = (sub.status === 'TRIAL' ? sub.trialEndsAt : sub.paidUntil) ?? new Date(now.getTime() + 365 * DAY);
  const licence: Licence = {
    v: 1,
    id: randomUUID(),
    tenantId,
    clinicName: sub.tenant.name,
    plan: { code: sub.plan.code, name: sub.plan.name, maxStaff: sub.plan.maxStaff, features: sub.plan.features },
    deployment: sub.deployment,
    status: sub.cancelledAt ? 'CANCELLED' : sub.status,
    endsAt: ends.toISOString(),
    graceDays: sub.graceDays,
    suspended: !!sub.suspendedAt,
    issuedAt: now.toISOString(),
  };
  return { licence, text: signLicence(licence, key) };
}

/**
 * Installs a licence on this server, for the clinic it names (which must exist here, and be the
 * one asked for). A licence older than the installed one is refused: going back to an earlier,
 * more generous one is not possible.
 */
export async function installLicence(db: Db, text: string, source: 'sync' | 'upload', expectTenantId?: string) {
  const read = readLicence(text);
  if (!read.ok) throw new BadRequestException(read.reason);
  const l = read.licence;
  if (expectTenantId && l.tenantId !== expectTenantId) throw new BadRequestException(`This licence is for ${l.clinicName}, not this clinic.`);
  if (!(await db.tenant.findUnique({ where: { id: l.tenantId } }))) throw new BadRequestException(`This licence is for ${l.clinicName}, which is not on this server.`);
  const current = await db.installedLicence.findUnique({ where: { tenantId: l.tenantId } });
  if (current && current.licenceId === l.id) return { licence: l, changed: false };
  if (current && current.issuedAt > new Date(l.issuedAt)) throw new ConflictException('A newer licence is already installed.');
  await db.installedLicence.upsert({
    where: { tenantId: l.tenantId },
    create: { tenantId: l.tenantId, licence: text.trim(), licenceId: l.id, issuedAt: new Date(l.issuedAt), source },
    update: { licence: text.trim(), licenceId: l.id, issuedAt: new Date(l.issuedAt), source, installedAt: new Date() },
  });
  return { licence: l, changed: true };
}

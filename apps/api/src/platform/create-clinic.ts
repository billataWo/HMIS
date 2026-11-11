import { hashPassword, temporaryPasswordExpiry } from '../common/passwords.js';
import { randomInt } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { addStarterCatalog, type Db, type DeploymentType, type FacilityType } from '@hmis/db';
import { normalizePhone } from '../common/phone.js';

const DAY = 86_400_000;

/** Easy to read out over the phone and to type: no 0/O or 1/l/I. */
export function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `${part()}-${part()}-${part()}`;
}

export function ethiopianMobile(input: string) {
  const phone = normalizePhone(input);
  return /^0[79]\d{8}$/.test(phone) ? phone : null;
}

export interface NewClinic {
  /** The id the clinic has in the HMIS cloud (an own-server install created from its licence). */
  id?: string;
  name: string;
  nameAm?: string | null;
  type?: FacilityType;
  phone?: string | null;
  address?: string | null;
  adminName: string;
  adminPhone: string;
  starter?: boolean;
  /** Bill it as a service: the plan, and how long the free trial lasts. */
  subscription?: { planCode: string; trialDays: number; graceDays?: number; deployment?: DeploymentType };
}

/**
 * A new clinic with its first admin (temporary password, changed at the first sign-in, together
 * with setting up two-step sign-in), the starter price list and, on the HMIS cloud, its trial.
 */
export async function createClinic(db: Db, input: NewClinic, now = new Date()) {
  const phone = ethiopianMobile(input.adminPhone);
  if (!phone) throw new ConflictException(`"${input.adminPhone}" is not an Ethiopian mobile number (09... or 07...).`);
  if (await db.tenant.findFirst({ where: { name: { equals: input.name.trim(), mode: 'insensitive' } } })) {
    throw new ConflictException(`A clinic called "${input.name.trim()}" already exists.`);
  }
  const plan = input.subscription ? await db.plan.findUnique({ where: { code: input.subscription.planCode } }) : null;
  if (input.subscription && !plan) throw new NotFoundException(`No plan with code ${input.subscription.planCode}`);

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const tenant = await db.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        ...(input.id && { id: input.id }),
        name: input.name.trim(),
        nameAm: input.nameAm?.trim() || null,
        type: input.type ?? 'CLINIC',
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        users: { create: { fullName: input.adminName.trim(), phone, role: 'ADMIN', passwordHash, mustChangePassword: true, temporaryPasswordExpiresAt: temporaryPasswordExpiry(now) } },
      },
    });
    if (input.subscription && plan) {
      await tx.subscription.create({
        data: {
          tenantId: t.id,
          planId: plan.id,
          status: 'TRIAL',
          deployment: input.subscription.deployment ?? 'CLOUD',
          trialEndsAt: new Date(now.getTime() + input.subscription.trialDays * DAY),
          ...(input.subscription.graceDays !== undefined && { graceDays: input.subscription.graceDays }),
        },
      });
    }
    return t;
  });
  if (input.starter !== false) await addStarterCatalog(db, tenant.id);
  return { tenant, adminPhone: phone, password };
}

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { forgetSubscription } from '../platform/subscription.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { installLicence } from './licence.js';

const HOUR = 3_600_000;

/** Fetches this clinic server's licence from the cloud (with its sync token) and installs it. */
export async function refreshLicence(prisma: PrismaService, url: string, token: string) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/sync/licence`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The cloud gave no licence (${res.status})`);
  const { licence } = (await res.json()) as { licence: string };
  // Checked against HMIS's public key like an uploaded file: the cloud connection is not trusted for it.
  const result = await installLicence(prisma.system, licence, 'sync');
  forgetSubscription(result.licence.tenantId);
  return result;
}

/**
 * On a clinic server synced to the cloud: keeps its HMIS licence current, every hour while there
 * is internet. Paying in the cloud (or a suspension there) reaches the server within the hour;
 * without internet, the licence it has keeps working until its dates run out.
 */
@Injectable()
export class LicenceAgent implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Licence');
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    const url = process.env.SYNC_CLOUD_URL;
    const token = process.env.SYNC_TOKEN;
    if (!url || !token || process.env.HMIS_PLATFORM === '1') return;
    const run = async () => {
      try {
        const { licence, changed } = await refreshLicence(this.prisma, url, token);
        if (changed) this.log.log(`Licence updated: ${licence.plan.name}, until ${licence.endsAt.slice(0, 10)}`);
      } catch (e) {
        this.log.warn(`Licence not refreshed: ${e instanceof Error ? e.message : e}`);
      }
    };
    setTimeout(() => void run(), 5_000).unref();
    this.timer = setInterval(() => void run(), HOUR);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

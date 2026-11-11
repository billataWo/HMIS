import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Body, ConflictException, Controller, Get, Headers, HttpCode, HttpException, NotFoundException, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { clientIp } from '../common/client-ip.js';
import { clinicDay, dayRange } from '../common/clinic-day.js';
import { tenantContext } from '../common/tenant-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { voicePack, voiceVersion } from '../voice/voice.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const PAIRING_MINUTES = 10;
const NameSchema = z.object({ name: z.string().trim().min(2).max(80) });
const PairSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

/** Wrong pairing codes per address: after 10 within 15 minutes, that address waits 15 minutes. */
const pairFailures = new Map<string, { count: number; first: number; lockedUntil?: number }>();

/**
 * Waiting-room screens. The TV never holds a staff sign-in: an admin adds the screen here and
 * gets a short pairing code; the TV enters it once and receives its own key, which can only read
 * the queue board (queue numbers and doctors, never patient names). Removing the screen, or
 * pairing it again, stops the old key at once.
 */
@Controller()
export class DisplaysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A fresh 6-digit code (unique while waiting), valid for 10 minutes. */
  private async withPairingCode(update: (data: { pairingCodeHash: string; pairingExpiresAt: Date }) => Promise<unknown>) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
      try {
        await update({ pairingCodeHash: sha256(code), pairingExpiresAt: expiresAt });
        return { code, expiresAt };
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e; // another screen waits with this code: draw again
      }
    }
    throw new ConflictException('Could not make a pairing code; try again');
  }

  @Get('displays')
  @Roles('ADMIN')
  async list(@CurrentUser() me: AuthUser) {
    const screens = await this.prisma.client.displayScreen.findMany({ where: { tenantId: me.tenantId }, orderBy: { createdAt: 'asc' } });
    return screens.map((s) => ({
      id: s.id,
      name: s.name,
      paired: !!s.tokenHash,
      waitingForCode: !!s.pairingCodeHash && !!s.pairingExpiresAt && s.pairingExpiresAt > new Date(),
      pairingExpiresAt: s.pairingExpiresAt,
      lastSeenAt: s.lastSeenAt,
      revokedAt: s.revokedAt,
      createdAt: s.createdAt,
    }));
  }

  @Post('displays')
  @Roles('ADMIN')
  async create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(NameSchema)) { name }: z.infer<typeof NameSchema>) {
    const screen = await this.prisma.client.displayScreen.create({ data: { tenantId: me.tenantId, name } });
    const pairing = await this.withPairingCode((data) => this.prisma.client.displayScreen.update({ where: { id: screen.id }, data }));
    await this.audit.log(me, 'display.create', 'DisplayScreen', screen.id, { name });
    return { id: screen.id, name, ...pairing };
  }

  /** Pair the screen again (new TV, or the browser was cleared): the old key stops working. */
  @Post('displays/:id/pairing-code')
  @Roles('ADMIN')
  @HttpCode(200)
  async newCode(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const screen = await this.find(me, id);
    const pairing = await this.withPairingCode((data) =>
      this.prisma.client.displayScreen.update({ where: { id: screen.id }, data: { ...data, tokenHash: null, revokedAt: null } }),
    );
    await this.audit.log(me, 'display.repair', 'DisplayScreen', screen.id);
    return { id: screen.id, name: screen.name, ...pairing };
  }

  @Post('displays/:id/revoke')
  @Roles('ADMIN')
  @HttpCode(200)
  async revoke(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const screen = await this.find(me, id);
    await this.prisma.client.displayScreen.update({
      where: { id: screen.id },
      data: { revokedAt: new Date(), tokenHash: null, pairingCodeHash: null, pairingExpiresAt: null },
    });
    await this.audit.log(me, 'display.revoke', 'DisplayScreen', screen.id);
    return { ok: true };
  }

  private async find(me: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Screen not found');
    const screen = await this.prisma.client.displayScreen.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!screen) throw new NotFoundException('Screen not found');
    return screen;
  }

  /** The TV enters its code once and gets its key (sent back only now; only its hash is kept). */
  @Public()
  @Post('display/pair')
  @HttpCode(200)
  async pair(@Req() req: Request, @Body(new ZodPipe(PairSchema)) { code }: z.infer<typeof PairSchema>) {
    const key = clientIp(req) ?? 'unknown';
    const f = pairFailures.get(key);
    if (f?.lockedUntil && f.lockedUntil > Date.now()) throw new HttpException('Too many wrong codes. Wait 15 minutes, then try again.', 429);

    // Before a clinic is known: the owner connection, by the code's hash.
    const screen = await this.prisma.system.displayScreen.findUnique({ where: { pairingCodeHash: sha256(code) } });
    if (!screen || screen.revokedAt || !screen.pairingExpiresAt || screen.pairingExpiresAt < new Date()) {
      const now = Date.now();
      const entry = !f || now - f.first > 15 * 60_000 || (f.lockedUntil && f.lockedUntil <= now) ? { count: 0, first: now } : f;
      entry.count += 1;
      if (entry.count >= 10) entry.lockedUntil = now + 15 * 60_000;
      pairFailures.set(key, entry);
      throw new UnauthorizedException('That code is not right, or it has expired. Ask an admin for a new one.');
    }
    pairFailures.delete(key);
    const token = randomBytes(32).toString('base64url');
    // Used up only if nobody paired with it a moment ago.
    const claimed = await this.prisma.system.displayScreen.updateMany({
      where: { id: screen.id, pairingCodeHash: screen.pairingCodeHash },
      data: { tokenHash: sha256(token), pairingCodeHash: null, pairingExpiresAt: null, lastSeenAt: new Date() },
    });
    if (!claimed.count) throw new UnauthorizedException('That code was just used. Ask an admin for a new one.');
    await this.prisma.system.auditLog.create({
      data: { tenantId: screen.tenantId, userId: null, action: 'display.paired', entity: 'DisplayScreen', entityId: screen.id, data: { ip: clientIp(req) } },
    });
    return { token, name: screen.name };
  }

  /**
   * The queue board, for a paired screen's key only: today's numbers and doctors, nothing about
   * patients. Read under the clinic's row-level security like any other request.
   */
  @Public()
  @Get('display/queue')
  async board(@Headers('authorization') authorization: string | undefined) {
    const screen = await this.screen(authorization);
    if (!screen.lastSeenAt || Date.now() - screen.lastSeenAt.getTime() > 60_000) {
      await this.prisma.system.displayScreen.update({ where: { id: screen.id }, data: { lastSeenAt: new Date() } });
    }

    const day = clinicDay();
    const { start, end } = dayRange(day);
    return tenantContext.run({ tenantId: screen.tenantId }, async () => {
      const db = this.prisma.client;
      const [tenant, serving, waiting, voice] = await Promise.all([
        db.tenant.findUniqueOrThrow({ where: { id: screen.tenantId }, select: { name: true, nameAm: true } }),
        db.visit.findMany({
          where: { tenantId: screen.tenantId, kind: 'OPD', status: 'IN_CONSULTATION', checkedInAt: { gte: start, lt: end } },
          orderBy: { calledAt: 'desc' },
          select: { id: true, queueNumber: true, doctor: { select: { fullName: true, room: true } } },
        }),
        db.visit.findMany({
          where: { tenantId: screen.tenantId, kind: 'OPD', status: 'WAITING', checkedInAt: { gte: start, lt: end } },
          orderBy: { queueNumber: 'asc' },
          take: 10,
          select: { id: true, queueNumber: true, doctor: { select: { fullName: true, room: true } } },
        }),
        voiceVersion(this.prisma.system),
      ]);
      return {
        clinic: tenant,
        screen: screen.name,
        day,
        serving: serving.map((v) => ({ id: v.id, queueNumber: v.queueNumber, doctor: v.doctor?.fullName ?? null, room: v.doctor?.room ?? null })),
        next: waiting.map((v) => ({ id: v.id, queueNumber: v.queueNumber, doctor: v.doctor?.fullName ?? null, room: v.doctor?.room ?? null })),
        /** Which recorded voice to call with (null: none recorded, the TV uses its own voice). */
        voice,
      };
    });
  }

  /** The recorded voice for calling patients: the same for every clinic, for paired screens only. */
  @Public()
  @Get('display/voice')
  async voice(@Headers('authorization') authorization: string | undefined) {
    await this.screen(authorization);
    return voicePack(this.prisma.system);
  }

  private async screen(authorization: string | undefined) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (token.length < 32) throw new UnauthorizedException();
    const screen = await this.prisma.system.displayScreen.findUnique({ where: { tokenHash: sha256(token) } });
    if (!screen || screen.revokedAt) throw new UnauthorizedException({ message: 'This screen was removed or paired again', code: 'DISPLAY_REVOKED' });
    return screen;
  }
}

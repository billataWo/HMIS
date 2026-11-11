import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { clientIp } from '../common/client-ip.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { forgetVoiceVersion, sniffAudio, VOICE_KEY, VOICE_LANGS, VOICE_MAX_BYTES, voicePack } from '../voice/voice.js';
import { CurrentOperator, type Operator, PlatformGuard, PlatformRoles } from './platform-auth.js';

const ClipSchema = z.object({
  // Base64 of the audio; what it is gets checked from the bytes themselves.
  data: z.string().min(16).max(Math.ceil((VOICE_MAX_BYTES * 4) / 3) + 4).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Base64 audio'),
});

function clipId(lang: string, key: string) {
  if (!(VOICE_LANGS as readonly string[]).includes(lang) || !VOICE_KEY.test(key)) throw new NotFoundException();
  return { lang, key };
}

/**
 * The waiting-room voice, in the platform console: HMIS records it once (or uploads recordings)
 * and every clinic's TVs call patients with it. Owners change it; every operator can listen.
 */
@Controller('platform/voice')
@Public()
@UseGuards(PlatformGuard)
export class PlatformVoiceController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.system;
  }

  @Get()
  pack() {
    return voicePack(this.db);
  }

  @Put(':lang/:key')
  @PlatformRoles('OWNER')
  async save(@Req() req: Request, @CurrentOperator() op: Operator, @Param('lang') lang: string, @Param('key') key: string, @Body(new ZodPipe(ClipSchema)) body: z.infer<typeof ClipSchema>) {
    const id = clipId(lang, key);
    const data = Buffer.from(body.data, 'base64');
    if (data.length > VOICE_MAX_BYTES) throw new BadRequestException(`A clip can be at most ${Math.round(VOICE_MAX_BYTES / 1000)} kB`);
    const mime = sniffAudio(data);
    if (!mime) throw new BadRequestException('Not an audio file the screens can play (WAV, MP3, OGG, WebM or M4A)');
    const clip = await this.db.voiceClip.upsert({ where: { lang_key: id }, create: { ...id, mime, data }, update: { mime, data } });
    forgetVoiceVersion();
    await this.db.platformAuditLog.create({
      data: { operatorId: op.sub, action: 'voice.saved', entity: 'VoiceClip', entityId: `${lang}/${key}`, data: { bytes: data.length, mime }, ip: clientIp(req) },
    });
    return { lang, key, mime, bytes: data.length, updatedAt: clip.updatedAt };
  }

  @Delete(':lang/:key')
  @PlatformRoles('OWNER')
  @HttpCode(204)
  async remove(@Req() req: Request, @CurrentOperator() op: Operator, @Param('lang') lang: string, @Param('key') key: string) {
    const id = clipId(lang, key);
    const done = await this.db.voiceClip.deleteMany({ where: id });
    if (!done.count) throw new NotFoundException();
    forgetVoiceVersion();
    await this.db.platformAuditLog.create({ data: { operatorId: op.sub, action: 'voice.removed', entity: 'VoiceClip', entityId: `${lang}/${key}`, ip: clientIp(req) } });
  }
}

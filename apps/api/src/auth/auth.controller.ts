import { Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { normalizePhone } from '../common/phone.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AuthUser, CurrentUser, Public } from './auth.decorators.js';

const LoginSchema = z.object({
  phone: z.string().min(9),
  password: z.string().min(1),
  facilityId: z.uuid().optional(), // needed only when one phone has accounts at several facilities
});

// Compared against when the phone is unknown, so response time doesn't reveal which phones have accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    // Sign-in happens before we know the clinic, so this one lookup uses the owner connection.
    const candidates = await this.prisma.system.user.findMany({
      where: {
        phone: normalizePhone(body.phone),
        active: true,
        ...(body.facilityId ? { tenantId: body.facilityId } : {}),
      },
      include: { tenant: { select: { id: true, name: true, nameAm: true } } },
    });

    let user: (typeof candidates)[number] | undefined;
    for (const c of candidates) {
      if (await bcrypt.compare(body.password, c.passwordHash)) {
        user = c;
        break;
      }
    }
    if (!candidates.length) await bcrypt.compare(body.password, DUMMY_HASH);
    if (!user) throw new UnauthorizedException('Wrong phone number or password');

    const payload: AuthUser = { sub: user.id, tenantId: user.tenantId, role: user.role, name: user.fullName };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: user.id, fullName: user.fullName, role: user.role },
      facility: user.tenant,
    };
  }

  @Get('me')
  async me(@CurrentUser() me: AuthUser) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: me.sub, tenantId: me.tenantId, active: true },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        tenant: { select: { id: true, name: true, nameAm: true } },
      },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

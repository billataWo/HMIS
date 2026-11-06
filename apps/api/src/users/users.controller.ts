import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { normalizePhone } from '../common/phone.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { forgetAccount } from '../auth/auth.guard.js';

const RoleEnum = z.enum(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'CASHIER', 'PHARMACIST', 'LAB_TECH']);

const CreateUserSchema = z.object({
  fullName: z.string().trim().min(2),
  phone: z.string().min(9).transform(normalizePhone),
  email: z.email().optional(),
  role: RoleEnum,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const UpdateUserSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  role: RoleEnum.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

const publicFields = { id: true, fullName: true, phone: true, email: true, role: true, active: true, createdAt: true };

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.prisma.client.user.findMany({
      where: { tenantId: me.tenantId },
      select: publicFields,
      orderBy: { fullName: 'asc' },
    });
  }

  @Post()
  async create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(CreateUserSchema)) body: z.infer<typeof CreateUserSchema>) {
    const exists = await this.prisma.client.user.findFirst({ where: { tenantId: me.tenantId, phone: body.phone } });
    if (exists) throw new ConflictException('A staff account with this phone number already exists');

    const { password, ...rest } = body;
    const user = await this.prisma.client.user.create({
      // The admin chose this password, so it is temporary: the new user replaces it at first sign-in.
      data: { ...rest, tenantId: me.tenantId, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true },
      select: publicFields,
    });
    await this.audit.log(me, 'user.create', 'User', user.id, { role: user.role });
    return user;
  }

  @Patch(':id')
  async update(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateUserSchema)) body: z.infer<typeof UpdateUserSchema>,
  ) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const existing = await this.prisma.client.user.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!existing) throw new NotFoundException();
    if (id === me.sub && (body.active === false || (body.role && body.role !== 'ADMIN'))) {
      throw new ConflictException('You cannot deactivate yourself or remove your own admin role');
    }

    const { password, ...rest } = body;
    const user = await this.prisma.client.user.update({
      where: { id },
      // A password reset by an admin is temporary too.
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true } : {}) },
      select: publicFields,
    });
    forgetAccount(id); // deactivation or a new role applies on the user's next request
    await this.audit.log(me, 'user.update', 'User', id, { ...rest, passwordChanged: !!password });
    return user;
  }
}

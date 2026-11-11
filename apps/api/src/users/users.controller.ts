import { hashPassword, temporaryPasswordExpiry } from '../common/passwords.js';
import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { normalizePhone } from '../common/phone.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { forgetAccount } from '../auth/auth.guard.js';
import { tenantPlan } from '../platform/subscription.guard.js';

const RoleEnum = z.enum(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'CASHIER', 'PHARMACIST', 'LAB_TECH']);

const CreateUserSchema = z.object({
  fullName: z.string().trim().min(2),
  phone: z.string().min(9).transform(normalizePhone),
  email: z.email().optional(),
  role: RoleEnum,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  room: z.string().trim().max(40).transform((r) => r || undefined).optional(),
});

const UpdateUserSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  role: RoleEnum.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  resetTwoStep: z.literal(true).optional(), // lost phone: the user sets two-step sign-in up again
  /** Where they see patients ("Room 2"); empty clears it. */
  room: z
    .string()
    .trim()
    .max(40)
    .transform((r) => r || null)
    .nullable()
    .optional(),
});

const publicFields = { id: true, fullName: true, phone: true, email: true, role: true, room: true, active: true, createdAt: true, totpEnabledAt: true };

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The plan limits how many staff accounts can be active at once. */
  private async checkStaffLimit(tenantId: string) {
    const plan = await tenantPlan(this.prisma, tenantId);
    if (plan.maxStaff === null) return;
    const active = await this.prisma.client.user.count({ where: { tenantId, active: true } });
    if (active >= plan.maxStaff) {
      throw new ForbiddenException({
        message: `The ${plan.planName} plan allows ${plan.maxStaff} active staff accounts. Deactivate someone who has left, or ask HMIS for a bigger plan (Settings → Subscription).`,
        code: 'STAFF_LIMIT',
      });
    }
  }

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
    await this.checkStaffLimit(me.tenantId);

    const { password, ...rest } = body;
    const user = await this.prisma.client.user.create({
      // The admin chose this password, so it is temporary: the new user replaces it at first sign-in.
      data: { ...rest, tenantId: me.tenantId, passwordHash: await hashPassword(password), mustChangePassword: true, temporaryPasswordExpiresAt: temporaryPasswordExpiry() },
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
    if (body.active === true && !existing.active) await this.checkStaffLimit(me.tenantId);

    const { password, resetTwoStep, ...rest } = body;
    const twoStepReset = resetTwoStep
      ? { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryCodes: [], sessionsValidAfter: new Date() }
      : {};
    const user = await this.prisma.client.user.update({
      where: { id },
      // A password reset by an admin is temporary too.
      // A reset also ends the user's current sign-ins (whoever knew the old password is out).
      data: { ...rest, ...twoStepReset, ...(password ? { passwordHash: await hashPassword(password), mustChangePassword: true, temporaryPasswordExpiresAt: temporaryPasswordExpiry(), sessionsValidAfter: new Date() } : {}) },
      select: publicFields,
    });
    forgetAccount(id); // deactivation or a new role applies on the user's next request
    await this.audit.log(me, 'user.update', 'User', id, { ...rest, passwordChanged: !!password, ...(resetTwoStep && { twoStepReset: true }) });
    return user;
  }
}

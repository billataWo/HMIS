import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { toCents } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const price = z.number().min(0).max(1_000_000);
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();

const ServiceSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Use 2–20 letters, digits or dashes'),
  name: z.string().trim().min(2).max(200),
  price,
  // CONSULTATION: offered as the fee at check-in. PROCEDURE: added during the visit by whoever gives it.
  kind: z.enum(['CONSULTATION', 'PROCEDURE']).default('CONSULTATION'),
});
const ServiceUpdateSchema = ServiceSchema.omit({ code: true }).partial().extend({ active: z.boolean().optional() });

/** A panel component: its own unit and range, or its own answer choices. */
const ComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    unit: nullableText(30),
    refLow: z.number().nullable().optional(),
    refHigh: z.number().nullable().optional(),
    resultOptions: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  })
  .refine((c) => c.refLow == null || c.refHigh == null || c.refLow < c.refHigh, { message: 'Low must be below high', path: ['refHigh'] });
const components = z.array(ComponentSchema).max(40);

const LabTestSchema = z
  .object({
    components: components.default([]),
    name: z.string().trim().min(2).max(200),
    loincCode: nullableText(20),
    unit: nullableText(30),
    refLow: z.number().nullable().optional(),
    refHigh: z.number().nullable().optional(),
    price,
    resultOptions: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  })
  .refine((t) => t.refLow == null || t.refHigh == null || t.refLow < t.refHigh, { message: 'Low must be below high', path: ['refHigh'] })
  .refine((t) => !(t.resultOptions.length && (t.refLow != null || t.refHigh != null)), {
    message: 'A test has either answer choices or a numeric range, not both',
    path: ['resultOptions'],
  });
const LabTestUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    loincCode: nullableText(20),
    unit: nullableText(30),
    refLow: z.number().nullable().optional(),
    refHigh: z.number().nullable().optional(),
    price: price.optional(),
    resultOptions: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    components: components.optional(),
    active: z.boolean().optional(),
  })
  .refine((t) => t.refLow == null || t.refHigh == null || t.refLow < t.refHigh, { message: 'Low must be below high', path: ['refHigh'] });

const componentData = (tenantId: string, c: z.infer<typeof ComponentSchema>, sortOrder: number) => ({
  tenantId,
  sortOrder,
  name: c.name,
  unit: c.unit ?? null,
  refLow: dec(c.refLow, 3) ?? null,
  refHigh: dec(c.refHigh, 3) ?? null,
  resultOptions: c.resultOptions,
});

const dec = (n: number | null | undefined, places: number) => (n === undefined ? undefined : n === null ? null : n.toFixed(places));
const priceChange = (from: { toString(): string }, to: number | undefined) =>
  to !== undefined && toCents(from) !== toCents(to) ? { price: { from: from.toString(), to: to.toFixed(2) } } : {};

/** Prices and catalogues that drive billing; admin only, and every change is audited. */
@Controller('catalog')
@Roles('ADMIN')
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('services')
  services(@CurrentUser() me: AuthUser) {
    return this.prisma.client.serviceItem.findMany({ where: { tenantId: me.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  @Post('services')
  async createService(@CurrentUser() me: AuthUser, @Body(new ZodPipe(ServiceSchema)) body: z.infer<typeof ServiceSchema>) {
    const exists = await this.prisma.client.serviceItem.findFirst({ where: { tenantId: me.tenantId, code: body.code } });
    if (exists) throw new ConflictException(`Code ${body.code} is already used`);
    const s = await this.prisma.client.serviceItem.create({ data: { ...body, price: body.price.toFixed(2), tenantId: me.tenantId } });
    await this.audit.log(me, 'service.create', 'ServiceItem', s.id, { code: s.code, price: s.price.toString() });
    return s;
  }

  @Patch('services/:id')
  async updateService(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ServiceUpdateSchema)) body: z.infer<typeof ServiceUpdateSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Service not found');
    const s = await this.prisma.client.serviceItem.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!s) throw new NotFoundException('Service not found');
    const updated = await this.prisma.client.serviceItem.update({ where: { id }, data: { ...body, price: dec(body.price, 2) ?? undefined } });
    await this.audit.log(me, 'service.update', 'ServiceItem', id, { fields: Object.keys(body), ...priceChange(s.price, body.price) });
    return updated;
  }

  @Get('lab-tests')
  labTests(@CurrentUser() me: AuthUser) {
    return this.prisma.client.labTest.findMany({
      where: { tenantId: me.tenantId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  @Post('lab-tests')
  async createLabTest(@CurrentUser() me: AuthUser, @Body(new ZodPipe(LabTestSchema)) body: z.infer<typeof LabTestSchema>) {
    const exists = await this.prisma.client.labTest.findFirst({ where: { tenantId: me.tenantId, name: { equals: body.name, mode: 'insensitive' } } });
    if (exists) throw new ConflictException('A test with this name already exists');
    const { components: parts, ...fields } = body;
    const t = await this.prisma.client.labTest.create({
      data: {
        ...fields,
        tenantId: me.tenantId,
        price: body.price.toFixed(2),
        refLow: dec(body.refLow, 3),
        refHigh: dec(body.refHigh, 3),
        components: { create: parts.map((c, i) => componentData(me.tenantId, c, i)) },
      },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.log(me, 'labtest.create', 'LabTest', t.id, { name: t.name, price: t.price.toString() });
    return t;
  }

  @Patch('lab-tests/:id')
  async updateLabTest(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(LabTestUpdateSchema)) body: z.infer<typeof LabTestUpdateSchema>) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Lab test not found');
    const t = await this.prisma.client.labTest.findFirst({ where: { id, tenantId: me.tenantId } });
    if (!t) throw new NotFoundException('Lab test not found');
    const { components: parts, ...fields } = body;
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (parts) {
        // Results already entered point at the current components, so they can't be replaced then.
        const used = await tx.labResultValue.count({ where: { component: { labTestId: id } } });
        if (used) throw new ConflictException('Results were already entered with these components; add a new test instead, and deactivate this one');
        await tx.labTestComponent.deleteMany({ where: { labTestId: id } });
        await tx.labTestComponent.createMany({ data: parts.map((c, i) => ({ ...componentData(me.tenantId, c, i), labTestId: id })) });
      }
      return tx.labTest.update({
        where: { id },
        data: { ...fields, price: dec(body.price, 2) ?? undefined, refLow: dec(body.refLow, 3), refHigh: dec(body.refHigh, 3) },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
      });
    });
    await this.audit.log(me, 'labtest.update', 'LabTest', id, { fields: Object.keys(body), ...priceChange(t.price, body.price) });
    return updated;
  }
}

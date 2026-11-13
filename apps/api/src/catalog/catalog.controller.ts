import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { applyRecommendedRanges, type Db } from '@hmis/db';
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

/** Limits must make sense together: low below high, critical beyond normal. */
const limits = <T extends { refLow?: number | null; refHigh?: number | null; critLow?: number | null; critHigh?: number | null }>(o: z.ZodType<T>) =>
  o
    .refine((r) => r.refLow == null || r.refHigh == null || r.refLow < r.refHigh, { message: 'Low must be below high', path: ['refHigh'] })
    .refine((r) => r.critLow == null || r.critHigh == null || r.critLow < r.critHigh, { message: 'Critical low must be below critical high', path: ['critHigh'] })
    .refine((r) => r.critLow == null || r.refLow == null || r.critLow <= r.refLow, { message: 'Critical low must be at or below the normal low', path: ['critLow'] })
    .refine((r) => r.critHigh == null || r.refHigh == null || r.critHigh >= r.refHigh, { message: 'Critical high must be at or above the normal high', path: ['critHigh'] });
const limit = z.number().min(-1_000_000).max(1_000_000).nullable().optional();
const RangeSchema = limits(
  z
    .object({
      componentId: z.uuid().nullable().optional(),
      sex: z.enum(['MALE', 'FEMALE']).nullable().optional(),
      ageFromDays: z.number().int().min(0).max(150 * 365).default(0),
      ageToDays: z.number().int().min(1).max(150 * 365).nullable().optional(),
      refLow: limit,
      refHigh: limit,
      critLow: limit,
      critHigh: limit,
    })
    .refine((r) => r.ageToDays == null || r.ageToDays > r.ageFromDays, { message: 'The age group must end after it starts', path: ['ageToDays'] }),
);
const RangesSchema = z.object({
  critLow: limit,
  critHigh: limit,
  components: z.array(z.object({ id: z.uuid(), critLow: limit, critHigh: limit })).max(60).default([]),
  ranges: z.array(RangeSchema).max(100).default([]),
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
      include: { components: { orderBy: { sortOrder: 'asc' }, include: { ranges: true } }, ranges: true },
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
      include: { components: { orderBy: { sortOrder: 'asc' }, include: { ranges: true } }, ranges: true },
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
        include: { components: { orderBy: { sortOrder: 'asc' }, include: { ranges: true } }, ranges: true },
      });
    });
    await this.audit.log(me, 'labtest.update', 'LabTest', id, { fields: Object.keys(body), ...priceChange(t.price, body.price) });
    return updated;
  }

  /**
   * A test's critical (panic) limits and its ranges for men, women and age groups, for the test
   * itself or each panel component, saved together (the list replaces the current one). Results
   * already given keep the range they were judged by (printed with them).
   */
  /**
   * For clinics set up before ranges existed: adds the recommended critical limits and ranges for
   * men, women and children to the starter tests that have none of their own (never overwrites).
   */
  @Post('lab-tests/recommended-ranges')
  async recommendedRanges(@CurrentUser() me: AuthUser) {
    const filled = await this.prisma.client.$transaction((tx) => applyRecommendedRanges(tx as unknown as Db, me.tenantId));
    await this.audit.log(me, 'labtest.recommended-ranges', 'LabTest', undefined, { filled });
    return { filled };
  }

  @Put('lab-tests/:id/ranges')
  async saveRanges(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(RangesSchema)) body: z.infer<typeof RangesSchema>) {
    const t = await this.prisma.client.labTest.findFirst({ where: { id, tenantId: me.tenantId }, include: { components: true } });
    if (!t) throw new NotFoundException('Lab test not found');
    const ids = new Set(t.components.map((c) => c.id));
    for (const c of body.components) if (!ids.has(c.id)) throw new NotFoundException('That component is not part of this test');
    for (const r of body.ranges) if (r.componentId && !ids.has(r.componentId)) throw new NotFoundException('That component is not part of this test');
    if (t.components.length && body.ranges.some((r) => !r.componentId)) throw new ConflictException('This is a panel: give each range a component');
    // Critical limits sit beyond the normal range of the test (or component) they belong to.
    const beyond = (name: string, ref: { refLow: unknown; refHigh: unknown }, crit: { critLow?: number | null; critHigh?: number | null }) => {
      if (crit.critLow != null && ref.refLow != null && crit.critLow > Number(ref.refLow)) {
        throw new ConflictException(`${name}: the critical low must be at or below the normal low (${Number(ref.refLow)})`);
      }
      if (crit.critHigh != null && ref.refHigh != null && crit.critHigh < Number(ref.refHigh)) {
        throw new ConflictException(`${name}: the critical high must be at or above the normal high (${Number(ref.refHigh)})`);
      }
    };
    beyond(t.name, t, body);
    for (const c of body.components) beyond(t.components.find((x) => x.id === c.id)!.name, t.components.find((x) => x.id === c.id)!, c);
    // Two ranges for the same thing, the same people and overlapping ages would leave the choice to chance.
    for (const [i, a] of body.ranges.entries()) {
      for (const b of body.ranges.slice(i + 1)) {
        const overlap = a.ageFromDays < (b.ageToDays ?? Infinity) && b.ageFromDays < (a.ageToDays ?? Infinity);
        if ((a.componentId ?? null) === (b.componentId ?? null) && (a.sex ?? null) === (b.sex ?? null) && overlap) {
          const name = a.componentId ? t.components.find((c) => c.id === a.componentId)!.name : t.name;
          const who = a.sex ? (a.sex === 'MALE' ? 'men' : 'women') : 'patients';
          throw new ConflictException(`Two ranges for ${name} cover the same ${who} at the same ages`);
        }
      }
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      // The whole set is replaced: a limit left out is cleared.
      await tx.labTest.update({ where: { id }, data: { critLow: dec(body.critLow ?? null, 3), critHigh: dec(body.critHigh ?? null, 3) } });
      for (const c of body.components) {
        await tx.labTestComponent.update({ where: { id: c.id }, data: { critLow: dec(c.critLow ?? null, 3), critHigh: dec(c.critHigh ?? null, 3) } });
      }
      await tx.labRange.deleteMany({ where: { OR: [{ labTestId: id }, { componentId: { in: [...ids] } }] } });
      if (body.ranges.length) {
        await tx.labRange.createMany({
          data: body.ranges.map((r) => ({
            tenantId: me.tenantId,
            labTestId: r.componentId ? null : id,
            componentId: r.componentId ?? null,
            sex: r.sex ?? null,
            ageFromDays: r.ageFromDays,
            ageToDays: r.ageToDays ?? null,
            refLow: dec(r.refLow, 3) ?? null,
            refHigh: dec(r.refHigh, 3) ?? null,
            critLow: dec(r.critLow, 3) ?? null,
            critHigh: dec(r.critHigh, 3) ?? null,
          })),
        });
      }
      return tx.labTest.findUniqueOrThrow({ where: { id }, include: { components: { orderBy: { sortOrder: 'asc' }, include: { ranges: true } }, ranges: true } });
    });
    await this.audit.log(me, 'labtest.ranges', 'LabTest', id, { critLow: body.critLow, critHigh: body.critHigh, ranges: body.ranges.length });
    return updated;
  }
}

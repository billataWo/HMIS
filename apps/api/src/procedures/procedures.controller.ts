import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AuditService } from '../common/audit.service.js';
import { chargeTerms } from '../common/settlement.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const AddSchema = z.object({
  serviceId: z.uuid(),
  quantity: z.number().int().min(1).max(50).default(1),
});

/**
 * Procedures given during a visit (injection, IV fluids, dressing, suturing, ECG…). Recording one
 * creates the charge, so nothing done in the room goes unbilled.
 */
@Controller('visits/:visitId/procedures')
export class ProceduresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async visit(me: AuthUser, visitId: string) {
    if (!z.uuid().safeParse(visitId).success) throw new NotFoundException('Visit not found');
    const visit = await this.prisma.client.visit.findFirst({ where: { id: visitId, tenantId: me.tenantId } });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  @Get()
  @Roles('ADMIN', 'DOCTOR', 'NURSE', 'CASHIER')
  async list(@CurrentUser() me: AuthUser, @Param('visitId') visitId: string) {
    await this.visit(me, visitId);
    return this.prisma.client.charge.findMany({
      where: { visitId, source: 'PROCEDURE', voidedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, description: true, quantity: true, unitPrice: true, invoiceId: true, createdAt: true },
    });
  }

  @Post()
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async add(@CurrentUser() me: AuthUser, @Param('visitId') visitId: string, @Body(new ZodPipe(AddSchema)) body: z.infer<typeof AddSchema>) {
    const visit = await this.visit(me, visitId);
    if (visit.status === 'CANCELLED' || visit.status === 'COMPLETED') throw new ConflictException('This visit is closed');
    if (visit.kind === 'WALK_IN') throw new ConflictException('This is a pharmacy counter sale, not a consultation');
    if (visit.kind === 'LAB') throw new ConflictException('This is a lab-only visit, not a consultation');
    const service = await this.prisma.client.serviceItem.findFirst({ where: { id: body.serviceId, tenantId: me.tenantId, active: true, kind: 'PROCEDURE' } });
    if (!service) throw new NotFoundException('Procedure not found in the price list');
    const terms = await chargeTerms(this.prisma.client, visit, 'SERVICE', service.id, service.price);
    const charge = await this.prisma.client.charge.create({
      data: { visitId, source: 'PROCEDURE', sourceId: service.id, description: service.name, quantity: body.quantity, ...terms },
      select: { id: true, description: true, quantity: true, unitPrice: true, invoiceId: true, createdAt: true },
    });
    await this.audit.log(me, 'procedure.add', 'Visit', visitId, { code: service.code, quantity: body.quantity });
    return charge;
  }

  /** Removes a procedure recorded by mistake, while it is not on an invoice yet. */
  @Delete(':chargeId')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  async remove(@CurrentUser() me: AuthUser, @Param('visitId') visitId: string, @Param('chargeId') chargeId: string) {
    await this.visit(me, visitId);
    if (!z.uuid().safeParse(chargeId).success) throw new NotFoundException('Procedure not found');
    const charge = await this.prisma.client.charge.findFirst({ where: { id: chargeId, visitId, source: 'PROCEDURE', voidedAt: null } });
    if (!charge) throw new NotFoundException('Procedure not found');
    if (charge.invoiceId) throw new ConflictException('This procedure is already on an invoice; an admin removes it there (refunding it if paid)');
    await this.prisma.client.charge.delete({ where: { id: chargeId } });
    await this.audit.log(me, 'procedure.remove', 'Visit', visitId, { description: charge.description });
    return { ok: true };
  }
}

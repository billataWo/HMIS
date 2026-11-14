import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@hmis/db';

/**
 * New work (a check-in, a booking, a sale) never goes on a duplicate record that was merged away:
 * it says which record to use instead.
 */
export async function assertNotMerged(db: { patient: Prisma.TransactionClient['patient'] }, patient: { mergedIntoId: string | null }) {
  if (!patient.mergedIntoId) return;
  const keeper = await db.patient.findUnique({ where: { id: patient.mergedIntoId }, select: { mrn: true } });
  throw new ConflictException(`This record was merged into ${keeper?.mrn ?? 'another record'}: use that one`);
}

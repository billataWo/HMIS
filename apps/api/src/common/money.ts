/**
 * Money is handled as integer cents in application code to avoid floating-point errors, and
 * stored as Decimal(12,2) in the database.
 */
export function toCents(value: { toString(): string } | number | string): number {
  return Math.round(Number(value.toString()) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

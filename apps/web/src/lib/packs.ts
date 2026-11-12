/** Drugs are bought by the pack (a box of 100) but stocked, sold and dispensed by the unit. */
type Packed = { packSize?: number | null; packName?: string | null; unit: string };

const plural = (word: string, n: number) => (n === 1 ? word : /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);

/** "5 boxes of 100 + 20 tablets", or null when the drug has no pack size or it's under one pack. */
export function inPacks(qty: number, d: Packed): string | null {
  if (!d.packSize || qty < d.packSize) return null;
  const full = Math.floor(qty / d.packSize);
  const rest = qty % d.packSize;
  return `${full} ${plural(d.packName || "pack", full)} of ${d.packSize}${rest ? ` + ${rest} ${plural(d.unit, rest)}` : ""}`;
}

/** "box of 100 tablets" */
export const packLabel = (d: Packed) => (d.packSize ? `${d.packName || "pack"} of ${d.packSize} ${plural(d.unit, d.packSize)}` : null);

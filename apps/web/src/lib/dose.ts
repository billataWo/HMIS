/**
 * How many dispensing units one dose takes, read from what the doctor typed: "2 tablets" → 2,
 * "1 g" of a 500 mg tablet → 2, "½ tab" → 0.5. Anything it can't work out safely (millilitres of a
 * syrup sold by the bottle, units, drops…) counts as one unit, and the doctor can still change the
 * quantity by hand.
 */
const MASS: Record<string, number> = { mcg: 0.001, µg: 0.001, ug: 0.001, mg: 1, g: 1000, gm: 1000, gram: 1000, grams: 1000 };

// Words doctors use for one countable unit, beyond the drug's own unit name. Not "puffs", "drops"
// or "units": an inhaler, a bottle of drops or a vial of insulin holds many of those.
const COUNT_WORDS = ["tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "sachet", "sachets", "supp", "suppository", "suppositories", "vial", "vials", "amp", "ampoule", "ampoules", "bottle", "bottles", "tube", "tubes"];

function amount(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "½" || t === "1/2") return 0.5;
  if (t === "¼" || t === "1/4") return 0.25;
  if (t === "1½" || t === "1 1/2") return 1.5;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mg(value: number, unit: string): number | null {
  const f = MASS[unit.toLowerCase()];
  return f ? value * f : null;
}

export function unitsPerDose(dose: string, drug: { unit: string; strength?: string | null }): number {
  const m = dose.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?|½|¼|1½|1\/2|1\/4|1 1\/2)\s*([a-zµ]*)\.?$/);
  if (!m) return 1;
  const n = amount(m[1]);
  if (!n) return 1;
  const word = m[2];
  const unit = drug.unit.trim().toLowerCase();
  if (!word || word === unit || word === `${unit}s` || COUNT_WORDS.includes(word)) return n;

  // A weight: divide by the strength of one unit, when that is a plain weight ("500 mg", not "125 mg/5 ml").
  const doseMg = mg(n, word);
  const s = drug.strength?.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*([a-zµ]+)$/);
  if (doseMg && s) {
    const per = mg(Number(s[1].replace(",", ".")), s[2]);
    if (per) {
      const ratio = doseMg / per;
      // Only whole or half units make sense to hand out; anything else is a typo or a liquid.
      if (ratio > 0 && ratio <= 20 && Number.isInteger(ratio * 2)) return ratio;
    }
  }
  return 1;
}

import type { PrismaClient } from "./generated/prisma/client.js";

/**
 * Recommended critical (panic) limits and ranges by sex and age for the starter lab tests: common
 * published values (WHO anaemia cut-offs, standard paediatric haematology). Analysers and
 * populations differ: have the laboratory head confirm them before relying on them.
 *
 * Ages are in days: 28 = newborn period, 180 = 6 months, 365 = 1 year.
 */
type Band = { sex?: "MALE" | "FEMALE"; from?: number; to?: number; low?: number; high?: number; critLow?: number; critHigh?: number };
type Rec = { critLow?: number; critHigh?: number; ranges?: Band[] };

const Y = 365;
const HAEMOGLOBIN: Rec = {
  critLow: 7,
  critHigh: 20,
  ranges: [
    { from: 0, to: 28, low: 14, high: 24, critHigh: 25 },
    { from: 180, to: 5 * Y, low: 11, high: 14 },
    { from: 5 * Y, to: 15 * Y, low: 11.5, high: 15.5 },
    { sex: "MALE", from: 15 * Y, low: 13, high: 17 },
    { sex: "FEMALE", from: 15 * Y, low: 12, high: 15.5 },
  ],
};
const WBC: Rec = {
  critLow: 2,
  critHigh: 30,
  ranges: [
    { from: 0, to: 28, low: 9, high: 30, critHigh: 40 },
    { from: 28, to: 2 * Y, low: 6, high: 17.5 },
    { from: 2 * Y, to: 12 * Y, low: 5, high: 15.5 },
  ],
};
const PLATELETS: Rec = { critLow: 20, critHigh: 1000 };
const HAEMATOCRIT: Rec = {
  critLow: 20,
  critHigh: 60,
  ranges: [
    { sex: "MALE", from: 15 * Y, low: 40, high: 50 },
    { sex: "FEMALE", from: 15 * Y, low: 36, high: 46 },
  ],
};

/** By test name; a panel's components by "Panel name/Component name". */
export const RECOMMENDED_RANGES: Record<string, Rec> = {
  Hemoglobin: HAEMOGLOBIN,
  "White blood cell count": WBC,
  "Platelet count": PLATELETS,
  ESR: { ranges: [{ sex: "MALE", low: 0, high: 15 }, { sex: "FEMALE", low: 0, high: 20 }] },
  "Fasting blood glucose": { critLow: 50, critHigh: 400 },
  "Random blood glucose": { critLow: 50, critHigh: 400 },
  Creatinine: {
    critHigh: 5,
    ranges: [
      { from: 0, to: 12 * Y, low: 0.3, high: 0.7 },
      { sex: "MALE", from: 12 * Y, low: 0.7, high: 1.3 },
      { sex: "FEMALE", from: 12 * Y, low: 0.6, high: 1.1 },
    ],
  },
  "Complete blood count (CBC)/Hemoglobin": HAEMOGLOBIN,
  "Complete blood count (CBC)/WBC": WBC,
  "Complete blood count (CBC)/Platelets": PLATELETS,
  "Complete blood count (CBC)/Hematocrit": HAEMATOCRIT,
};

/**
 * Turnaround targets in minutes, sample taken to result released: what a clinic lab with the usual
 * analysers reaches on a normal day. The clinic changes them per test in Settings → Prices.
 */
export const RECOMMENDED_TAT: Record<string, number> = {
  Hemoglobin: 60,
  "White blood cell count": 60,
  "Platelet count": 60,
  "Complete blood count (CBC)": 60,
  ESR: 90, // the tube stands for an hour
  "Fasting blood glucose": 60,
  "Random blood glucose": 30,
  HbA1c: 120,
  Creatinine: 120,
  "Malaria blood film": 60,
  "Urine hCG (pregnancy test)": 30,
  "H. pylori stool antigen": 60,
  "HIV rapid test": 30,
  "Widal test": 60,
  Urinalysis: 60,
  "Stool examination": 60,
};

/** Sets the recommended turnaround target on tests that have none. Returns the tests it set. */
export async function applyRecommendedTargets(db: PrismaClient, tenantId: string) {
  const tests = await db.labTest.findMany({ where: { tenantId, tatMinutes: null, name: { in: Object.keys(RECOMMENDED_TAT) } }, select: { id: true, name: true } });
  for (const t of tests) await db.labTest.update({ where: { id: t.id }, data: { tatMinutes: RECOMMENDED_TAT[t.name] } });
  return tests.map((t) => t.name);
}

const dec = (n: number | undefined) => (n === undefined ? null : n.toFixed(3));

/**
 * Adds the recommended limits and ranges to this clinic's tests that have none yet: a test or
 * component that already has a critical limit or a range of its own is left exactly as it is.
 * Returns what it filled in.
 */
export async function applyRecommendedRanges(db: PrismaClient, tenantId: string) {
  const tests = await db.labTest.findMany({ where: { tenantId }, include: { ranges: true, components: { include: { ranges: true } } } });
  const filled: string[] = [];
  for (const t of tests) {
    const targets = [
      { key: t.name, kind: "test" as const, id: t.id, has: t.critLow !== null || t.critHigh !== null || t.ranges.length > 0 },
      ...t.components.map((c) => ({ key: `${t.name}/${c.name}`, kind: "component" as const, id: c.id, has: c.critLow !== null || c.critHigh !== null || c.ranges.length > 0 })),
    ];
    for (const target of targets) {
      const rec = RECOMMENDED_RANGES[target.key];
      if (!rec || target.has) continue;
      const crit = { critLow: dec(rec.critLow), critHigh: dec(rec.critHigh) };
      if (target.kind === "test") await db.labTest.update({ where: { id: target.id }, data: crit });
      else await db.labTestComponent.update({ where: { id: target.id }, data: crit });
      if (rec.ranges?.length) {
        await db.labRange.createMany({
          data: rec.ranges.map((b) => ({
            tenantId,
            ...(target.kind === "test" ? { labTestId: target.id } : { componentId: target.id }),
            sex: b.sex ?? null,
            ageFromDays: b.from ?? 0,
            ageToDays: b.to ?? null,
            refLow: dec(b.low),
            refHigh: dec(b.high),
            critLow: dec(b.critLow),
            critHigh: dec(b.critHigh),
          })),
        });
      }
      filled.push(target.key);
    }
  }
  return filled;
}

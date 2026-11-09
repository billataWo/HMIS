import type { PrismaClient } from "./generated/prisma/client.js";

// Adult reference ranges; review them with the lab (some differ by sex, age and analyser).
// LOINC codes are given only where well established.
const LAB_TESTS: {
  name: string;
  loincCode?: string;
  unit?: string;
  refLow?: string;
  refHigh?: string;
  price: string;
  resultOptions?: string[];
}[] = [
  { name: "Hemoglobin", loincCode: "718-7", unit: "g/dL", refLow: "12", refHigh: "17", price: "100.00" },
  { name: "White blood cell count", loincCode: "6690-2", unit: "×10³/µL", refLow: "4", refHigh: "11", price: "80.00" },
  { name: "Platelet count", loincCode: "777-3", unit: "×10³/µL", refLow: "150", refHigh: "450", price: "80.00" },
  { name: "ESR", loincCode: "4537-7", unit: "mm/h", refLow: "0", refHigh: "20", price: "60.00" },
  { name: "Fasting blood glucose", loincCode: "1558-6", unit: "mg/dL", refLow: "70", refHigh: "100", price: "80.00" },
  { name: "Random blood glucose", loincCode: "2345-7", unit: "mg/dL", refLow: "70", refHigh: "140", price: "60.00" },
  { name: "HbA1c", loincCode: "4548-4", unit: "%", refLow: "4", refHigh: "5.6", price: "450.00" },
  { name: "Creatinine", loincCode: "2160-0", unit: "mg/dL", refLow: "0.6", refHigh: "1.3", price: "150.00" },
  { name: "Malaria blood film", loincCode: "32700-7", price: "60.00", resultOptions: ["Negative", "P. falciparum", "P. vivax", "Mixed (Pf + Pv)"] },
  { name: "Urine hCG (pregnancy test)", loincCode: "2106-3", price: "80.00", resultOptions: ["Negative", "Positive"] },
  { name: "H. pylori stool antigen", price: "200.00", resultOptions: ["Negative", "Positive"] },
  { name: "HIV rapid test", price: "0.00", resultOptions: ["Non-reactive", "Reactive", "Indeterminate"] },
  { name: "Widal test", price: "120.00" },
  { name: "Urinalysis", loincCode: "24356-8", price: "80.00" },
  { name: "Stool examination", price: "60.00" },
];

/**
 * The starter price list every new clinic gets: consultations, procedures, common lab tests and
 * panels. Prices are suggestions the clinic changes in Settings → Prices. Safe to re-run: adds only
 * what is missing and never changes a clinic's own prices.
 */
export async function addStarterCatalog(db: PrismaClient, tenantId: string, log: (line: string) => void = () => {}) {
  await db.serviceItem.createMany({
    skipDuplicates: true, // unique on (tenantId, code)
    data: [
      { tenantId, code: "CONS-GEN", name: "General consultation", price: "150.00" },
      { tenantId, code: "CONS-FU", name: "Follow-up consultation", price: "80.00" },
      { tenantId, code: "CARD", name: "Patient card", price: "50.00" },
      // Procedures given during the visit, charged by the doctor or nurse who gives them.
      { tenantId, code: "PR-INJ", name: "Injection (IM/IV)", price: "30.00", kind: "PROCEDURE" },
      { tenantId, code: "PR-IVF", name: "IV fluid administration", price: "100.00", kind: "PROCEDURE" },
      { tenantId, code: "PR-DRS", name: "Wound dressing", price: "80.00", kind: "PROCEDURE" },
      { tenantId, code: "PR-SUT", name: "Suturing", price: "200.00", kind: "PROCEDURE" },
      { tenantId, code: "PR-NEB", name: "Nebulization", price: "100.00", kind: "PROCEDURE" },
      { tenantId, code: "PR-ECG", name: "ECG", price: "300.00", kind: "PROCEDURE" },
    ],
  });

  // Panels: one order, several results. Ranges are common adult values; have the clinical advisor
  // confirm them (several differ by sex and age).
  const level = ["Negative", "Trace", "1+", "2+", "3+"];
  const PANELS: { name: string; loincCode?: string; price: string; components: { name: string; unit?: string; refLow?: string; refHigh?: string; resultOptions?: string[] }[] }[] = [
    {
      name: "Complete blood count (CBC)",
      loincCode: "58410-2",
      price: "250.00",
      components: [
        { name: "WBC", unit: "×10³/µL", refLow: "4", refHigh: "11" },
        { name: "Neutrophils", unit: "%", refLow: "40", refHigh: "75" },
        { name: "Lymphocytes", unit: "%", refLow: "20", refHigh: "45" },
        { name: "RBC", unit: "×10⁶/µL", refLow: "4.2", refHigh: "5.9" },
        { name: "Hemoglobin", unit: "g/dL", refLow: "12", refHigh: "17" },
        { name: "Hematocrit", unit: "%", refLow: "36", refHigh: "50" },
        { name: "MCV", unit: "fL", refLow: "80", refHigh: "100" },
        { name: "Platelets", unit: "×10³/µL", refLow: "150", refHigh: "450" },
      ],
    },
    {
      name: "Urinalysis",
      loincCode: "24356-8",
      price: "80.00",
      components: [
        { name: "Colour" },
        { name: "Appearance", resultOptions: ["Clear", "Slightly turbid", "Turbid"] },
        { name: "pH", refLow: "4.5", refHigh: "8" },
        { name: "Specific gravity", refLow: "1.005", refHigh: "1.030" },
        { name: "Protein", resultOptions: level },
        { name: "Glucose", resultOptions: level },
        { name: "Ketones", resultOptions: level },
        { name: "Blood", resultOptions: level },
        { name: "Leukocytes", resultOptions: level },
        { name: "Nitrite", resultOptions: ["Negative", "Positive"] },
        { name: "WBC", unit: "/hpf", refLow: "0", refHigh: "5" },
        { name: "RBC", unit: "/hpf", refLow: "0", refHigh: "3" },
      ],
    },
  ];
  for (const panel of PANELS) {
    const test =
      (await db.labTest.findFirst({ where: { tenantId, name: panel.name }, include: { components: true } })) ??
      (await db.labTest.create({
        data: { tenantId, name: panel.name, loincCode: panel.loincCode, price: panel.price, resultOptions: [] },
        include: { components: true },
      }));
    if (test.components.length) continue; // never change a panel a clinic already has
    await db.labTestComponent.createMany({
      data: panel.components.map((c, i) => ({ tenantId, labTestId: test.id, sortOrder: i, resultOptions: c.resultOptions ?? [], ...c })),
    });
    log(`+ panel ${panel.name} (${panel.components.length} components)`);
  }

  for (const t of LAB_TESTS) {
    const existing = await db.labTest.findFirst({ where: { tenantId, name: t.name } });
    if (!existing) {
      await db.labTest.create({ data: { tenantId, ...t, resultOptions: t.resultOptions ?? [] } });
      log(`+ lab test ${t.name}`);
    } else if (!existing.resultOptions.length && t.resultOptions?.length) {
      // Tests created before answer choices existed get them; nothing else is changed.
      await db.labTest.update({ where: { id: existing.id }, data: { resultOptions: t.resultOptions } });
    }
  }
}

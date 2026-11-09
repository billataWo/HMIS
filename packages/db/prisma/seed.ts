import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient, type Role } from "../src/index.js";
import { addStarterCatalog } from "../src/starter.js";

const prisma = createPrismaClient();

// Safe to re-run: it only adds what is missing and never changes or deletes existing records.

const STAFF: { fullName: string; phone: string; password: string; role: Role }[] = [
  { fullName: "Clinic Admin", phone: "0911000000", password: "admin123", role: "ADMIN" },
  { fullName: "Hana Tesfaye", phone: "0911000001", password: "doctor123", role: "DOCTOR" },
  { fullName: "Meron Alemu", phone: "0911000002", password: "reception123", role: "RECEPTIONIST" },
  { fullName: "Yonas Bekele", phone: "0911000003", password: "pharmacy123", role: "PHARMACIST" },
  { fullName: "Tigist Haile", phone: "0911000004", password: "cashier123", role: "CASHIER" },
  { fullName: "Bethlehem Assefa", phone: "0911000005", password: "lab123", role: "LAB_TECH" },
];

// [generic, class, form, strength, unit, sell price ETB, reorder level, stock]
const DRUGS: [string, string | null, string, string, string, string, number, number][] = [
  ["Amoxicillin", "penicillin", "capsule", "500 mg", "capsule", "5.00", 200, 1000],
  ["Amoxicillin/Clavulanic acid", "penicillin", "tablet", "625 mg", "tablet", "18.00", 60, 200],
  ["Ceftriaxone", "cephalosporin", "injection", "1 g", "vial", "60.00", 20, 60],
  ["Ciprofloxacin", "fluoroquinolone", "tablet", "500 mg", "tablet", "6.00", 100, 400],
  ["Cotrimoxazole", "sulfonamide", "tablet", "960 mg", "tablet", "3.00", 100, 500],
  ["Doxycycline", "tetracycline", "capsule", "100 mg", "capsule", "4.00", 60, 300],
  ["Metronidazole", "nitroimidazole", "tablet", "500 mg", "tablet", "2.50", 100, 500],
  ["Fluconazole", "azole antifungal", "capsule", "150 mg", "capsule", "15.00", 20, 80],
  ["Albendazole", "anthelmintic", "tablet", "400 mg", "tablet", "8.00", 40, 150],
  ["Artemether/Lumefantrine", "antimalarial", "tablet", "20/120 mg", "tablet", "9.00", 96, 480],
  ["Paracetamol", "analgesic", "tablet", "500 mg", "tablet", "1.50", 500, 2000],
  ["Ibuprofen", "nsaid", "tablet", "400 mg", "tablet", "2.00", 200, 800],
  ["Diclofenac", "nsaid", "tablet", "50 mg", "tablet", "2.50", 100, 400],
  ["Omeprazole", "ppi", "capsule", "20 mg", "capsule", "4.00", 100, 400],
  ["Enalapril", "ace-inhibitor", "tablet", "10 mg", "tablet", "3.00", 100, 300],
  ["Amlodipine", "calcium channel blocker", "tablet", "5 mg", "tablet", "2.50", 100, 300],
  ["Hydrochlorothiazide", "thiazide diuretic", "tablet", "25 mg", "tablet", "1.50", 100, 300],
  ["Metformin", "biguanide", "tablet", "500 mg", "tablet", "2.00", 200, 600],
  ["Salbutamol", "beta-2 agonist", "inhaler", "100 mcg/dose", "inhaler", "180.00", 5, 20],
  ["Prednisolone", "corticosteroid", "tablet", "5 mg", "tablet", "1.50", 100, 300],
  ["Oral rehydration salts", null, "sachet", "20.5 g", "sachet", "10.00", 50, 200],
  ["Ferrous sulphate", "iron supplement", "tablet", "200 mg", "tablet", "1.00", 100, 500],
];

async function main() {
  const tenant =
    (await prisma.tenant.findFirst({ where: { name: "Demo Clinic" } })) ??
    (await prisma.tenant.create({
      data: { name: "Demo Clinic", nameAm: "ማሳያ ክሊኒክ", type: "CLINIC", phone: "+251911000000", address: "Addis Ababa" },
    }));

  for (const s of STAFF) {
    const exists = await prisma.user.findFirst({ where: { tenantId: tenant.id, phone: s.phone } });
    if (!exists) {
      await prisma.user.create({
        data: { tenantId: tenant.id, fullName: s.fullName, phone: s.phone, role: s.role, passwordHash: await bcrypt.hash(s.password, 10) },
      });
      console.log(`+ ${s.role.toLowerCase()} ${s.fullName}`);
    }
  }

  await addStarterCatalog(prisma, tenant.id, console.log);

  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 1);
  for (const [genericName, drugClass, form, strength, unit, sellPrice, reorderLevel, stock] of DRUGS) {
    const existing = await prisma.drug.findFirst({ where: { tenantId: tenant.id, genericName } });
    if (existing) {
      // Fill in the class on drugs created before classes existed; never overwrite one that is set.
      if (!existing.drugClass && drugClass) await prisma.drug.update({ where: { id: existing.id }, data: { drugClass } });
      continue;
    }
    await prisma.drug.create({
      data: {
        tenantId: tenant.id,
        genericName,
        drugClass,
        form,
        strength,
        unit,
        sellPrice,
        reorderLevel,
        batches: {
          create: { batchNo: `DEMO-${genericName.slice(0, 3).toUpperCase()}-01`, expiryDate: expiry, quantity: stock, costPrice: (Number(sellPrice) * 0.6).toFixed(2), supplier: "EPSS" },
        },
      },
    });
    console.log(`+ drug ${genericName}`);
  }

  console.log(`Demo Clinic ready (${tenant.id}).`);
  console.log(STAFF.map((s) => `${s.role.toLowerCase()} ${s.phone} / ${s.password}`).join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

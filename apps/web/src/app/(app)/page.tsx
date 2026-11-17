import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  ChartColumn,
  FlaskConical,
  ListOrdered,
  Package,
  Pill,
  Receipt,
  Stethoscope,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { StaggerCell, StaggerGrid } from "@/components/enter";
import { buttonClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, type Me, type Role } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { getLang } from "@/lib/lang";
import { canRegister } from "@/lib/roles";
import { Greeting } from "./today";

const MODULES: { name: string; nameAm: string; desc: string; href: string; icon: LucideIcon; roles?: Role[] }[] = [
  { name: "Queue", nameAm: "ወረፋ", desc: "Check-in, queue numbers and the waiting-room display", href: "/queue", icon: ListOrdered },
  { name: "Patients", nameAm: "ታካሚዎች", desc: "Registration, medical record numbers, search by phone", href: "/patients", icon: Users },
  { name: "Appointments", nameAm: "ቀጠሮዎች", desc: "Bookings, check-in on arrival, no-shows", href: "/appointments", icon: CalendarDays },
  { name: "Consultation", nameAm: "ምርመራ", desc: "Vitals, notes and ICD-11 diagnoses. Open a patient from the queue", href: "/queue", icon: Stethoscope, roles: ["ADMIN", "DOCTOR", "NURSE"] },
  { name: "Lab", nameAm: "ላብራቶሪ", desc: "Samples, results with normal ranges, printable reports", href: "/lab", icon: FlaskConical, roles: ["ADMIN", "LAB_TECH"] },
  { name: "Pharmacy", nameAm: "ፋርማሲ", desc: "Prescriptions to dispense, first-expiry-first-out", href: "/pharmacy", icon: Pill, roles: ["ADMIN", "PHARMACIST"] },
  { name: "Inventory", nameAm: "ክምችት", desc: "Stock, batches, expiry, deliveries and suppliers", href: "/inventory", icon: Package, roles: ["ADMIN", "PHARMACIST"] },
  { name: "Billing", nameAm: "ክፍያ", desc: "Invoices, Telebirr, Chapa, receipts, cash closing", href: "/billing", icon: Receipt, roles: ["ADMIN", "CASHIER"] },
  { name: "Reports", nameAm: "ሪፖርቶች", desc: "Revenue, patient counts, stock losses, monthly MoH report", href: "/reports", icon: ChartColumn, roles: ["ADMIN"] },
];

/** The one or two things each role does most, as buttons at the top of Home. */
const QUICK: Partial<Record<Role, { label: string; href: string; icon: LucideIcon }[]>> = {
  RECEPTIONIST: [
    { label: "Check in a patient", href: "/queue", icon: ListOrdered },
    { label: "Register patient", href: "/patients/new", icon: UserPlus },
    { label: "Book appointment", href: "/appointments/new", icon: CalendarPlus },
  ],
  NURSE: [
    { label: "Open the queue", href: "/queue", icon: ListOrdered },
    { label: "Register patient", href: "/patients/new", icon: UserPlus },
  ],
  DOCTOR: [{ label: "My patients", href: "/queue?doctor=me", icon: Stethoscope }],
  LAB_TECH: [{ label: "Lab worklist", href: "/lab", icon: FlaskConical }],
  PHARMACIST: [{ label: "Prescriptions to dispense", href: "/pharmacy", icon: Pill }],
  CASHIER: [{ label: "Bills to collect", href: "/billing", icon: Receipt }],
  ADMIN: [
    { label: "Today's queue", href: "/queue", icon: ListOrdered },
    { label: "Dashboard", href: "/reports", icon: ChartColumn },
  ],
};

async function HomeContent() {
  const [me, lang] = await Promise.all([api<Me>("/auth/me"), getLang()]);
  if (me.mustChangePassword) redirect("/account/password");
  // Admins must set up two-step sign-in first (the API refuses them everything else meanwhile).
  if (me.twoStep?.required && !me.twoStep.enabled) redirect("/account/two-step");
  const quick = [
    ...(QUICK[me.role] ?? []),
    ...(me.role === "DOCTOR" && canRegister(me) ? [{ label: "Register patient", href: "/patients/new", icon: UserPlus }] : []),
  ];
  const modules = MODULES.filter((m) => !m.roles || m.roles.includes(me.role));

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <Greeting name={me.fullName.split(" ")[0] ?? me.fullName} lang={lang} />
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q, i) => (
              <Link key={q.href + q.label} href={q.href} className={i === 0 ? buttonClass : secondaryButtonClass}>
                <q.icon aria-hidden />
                {tr(lang, q.label)}
              </Link>
            ))}
          </div>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-500">{tr(lang, "Your workspace")}</h2>
      <StaggerGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <StaggerCell key={m.name}>
            <Link
              href={m.href}
              className="group surface flex h-full flex-col p-5 transition-[box-shadow,border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-600/40 hover:shadow-raised"
            >
              <div className="flex items-start justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-600/10 transition-colors group-hover:bg-brand-700 group-hover:text-white dark:bg-brand-500/15 dark:text-brand-300">
                  <m.icon aria-hidden className="size-5" />
                </span>
                <ArrowRight aria-hidden className="size-4 -translate-x-1 text-slate-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100" />
              </div>
              <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">
                {lang === "am" ? m.nameAm : m.name} <span className="text-sm font-normal text-slate-500">{lang === "am" ? m.name : m.nameAm}</span>
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{tr(lang, m.desc)}</p>
            </Link>
          </StaggerCell>
        ))}
      </StaggerGrid>
    </>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-16 max-w-md" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { api, type Me, type Role } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { logout } from "../actions";

const NAV: { href: string; label: string; labelAm: string; roles?: Role[] }[] = [
  { href: "/", label: "Home", labelAm: "መነሻ" },
  { href: "/queue", label: "Queue", labelAm: "ወረፋ" },
  { href: "/appointments", label: "Appointments", labelAm: "ቀጠሮዎች" },
  { href: "/patients", label: "Patients", labelAm: "ታካሚዎች" },
  { href: "/lab", label: "Lab", labelAm: "ላብራቶሪ", roles: ["ADMIN", "LAB_TECH"] },
  { href: "/pharmacy", label: "Pharmacy", labelAm: "ፋርማሲ", roles: ["ADMIN", "PHARMACIST"] },
  { href: "/inventory", label: "Inventory", labelAm: "ክምችት", roles: ["ADMIN", "PHARMACIST"] },
  { href: "/billing", label: "Billing", labelAm: "ክፍያ", roles: ["ADMIN", "CASHIER"] },
  { href: "/reports", label: "Reports", labelAm: "ሪፖርቶች", roles: ["ADMIN"] },
  { href: "/users", label: "Staff", labelAm: "ሰራተኞች", roles: ["ADMIN"] },
  { href: "/settings", label: "Settings", labelAm: "ቅንብሮች", roles: ["ADMIN"] },
];

async function Sidebar() {
  const me = await api<Me>("/auth/me");
  return (
    <>
      <div className="mb-6">
        <p className="font-semibold">{me.tenant.name}</p>
        {me.tenant.nameAm && <p className="text-sm text-zinc-500">{me.tenant.nameAm}</p>}
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {NAV.filter((n) => !n.roles || n.roles.includes(me.role)).map((n) => (
          <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-zinc-200/60 dark:hover:bg-zinc-800">
            {n.label} <span className="text-zinc-500">· {n.labelAm}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-6 border-t border-zinc-200 pt-4 text-sm md:mt-auto dark:border-zinc-800">
        <p className="font-medium">{me.fullName}</p>
        <p className="text-zinc-500">{ROLE_LABELS[me.role]}</p>
        <form action={logout}>
          <button className="mt-2 text-teal-700 hover:underline dark:text-teal-400">Sign out</button>
        </form>
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-col border-b print:hidden border-zinc-200 bg-zinc-50 p-4 md:min-h-screen md:w-60 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense fallback={<div className="h-40 animate-pulse rounded bg-zinc-200/60 dark:bg-zinc-800" />}>
          <Sidebar />
        </Suspense>
      </aside>
      <main className="w-full max-w-5xl flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}

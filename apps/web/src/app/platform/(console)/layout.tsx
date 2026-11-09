import { Building2 } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { platformApi, type OperatorMe } from "@/lib/platform";

const LINKS = [
  { href: "/platform", label: "Overview" },
  { href: "/platform/requests", label: "Requests" },
  { href: "/platform/clinics", label: "Clinics" },
  { href: "/platform/plans", label: "Plans" },
  { href: "/platform/operators", label: "Operators", owner: true },
  { href: "/platform/settings", label: "Settings" },
  { href: "/platform/history", label: "History" },
];

async function Bar() {
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  const ready = !me.mustChangePassword && me.twoStep.enabled;
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/platform" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
          <Building2 aria-hidden className="size-5" /> HMIS platform
        </Link>
        {ready && (
          <nav aria-label="Platform" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {LINKS.filter((l) => !l.owner || me.role === "OWNER").map((l) => (
              <Link key={l.href} href={l.href} className="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
                {l.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/platform/account" className="text-slate-600 hover:underline dark:text-slate-300">
            {me.fullName} · {me.role.toLowerCase()}
          </Link>
          <a href="/platform/signout" className="text-slate-500 hover:underline">
            Sign out
          </a>
        </div>
      </div>
    </header>
  );
}

/** The platform console: HMIS staff only, separate from every clinic's screens. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<div className="h-14 border-b border-slate-200 dark:border-slate-800" />}>
        <Bar />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}

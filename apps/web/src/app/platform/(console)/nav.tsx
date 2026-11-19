"use client";

import { Building2, CreditCard, History, Inbox, LayoutDashboard, Mic, Receipt, Settings, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/platform", label: "Overview", icon: LayoutDashboard },
  { href: "/platform/requests", label: "Requests", icon: Inbox, count: "requests" },
  { href: "/platform/clinics", label: "Clinics", icon: Building2 },
  { href: "/platform/billing", label: "Billing", icon: Receipt, count: "payments" },
  { href: "/platform/plans", label: "Plans", icon: CreditCard },
  { href: "/platform/operators", label: "Operators", icon: Users, owner: true },
  { href: "/platform/voice", label: "Voice", icon: Mic },
  { href: "/platform/settings", label: "Settings", icon: Settings },
  { href: "/platform/history", label: "History", icon: History },
] as const;

const isCurrent = (path: string, href: string) => (href === "/platform" ? path === href : path === href || path.startsWith(`${href}/`));

/**
 * The console's sections: a sidebar on wide screens, a row of tabs that scrolls sideways on
 * phones. The current section is marked (aria-current), and Requests shows how many are waiting.
 */
export function ConsoleNav({ owner, waiting, toConfirm, ready }: { owner: boolean; waiting: number; toConfirm: number; ready: boolean }) {
  const path = usePathname();
  const links = ready ? LINKS.filter((l) => !("owner" in l) || owner) : [];
  const account = { href: "/platform/account", label: "Your account", icon: UserCog };

  const item = (l: { href: string; label: string; icon: typeof Inbox; count?: string }, compact: boolean) => {
    const current = isCurrent(path, l.href);
    const count = l.count === "requests" ? waiting : l.count === "payments" ? toConfirm : 0;
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={current ? "page" : undefined}
        className={`flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
          current
            ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        } ${compact ? "" : "w-full"}`}
      >
        <l.icon aria-hidden className={`size-4 shrink-0 ${current ? "text-brand-700 dark:text-brand-300" : "text-slate-400"}`} />
        {l.label}
        {count > 0 && (
          <span className="ml-auto rounded-full bg-amber-700 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white tabular-nums">
            {count > 999 ? "999+" : count}
            <span className="sr-only">{l.count === "payments" ? " to confirm" : " waiting"}</span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Phones and tablets: tabs under the top bar. */}
      <nav aria-label="Console" className="border-b border-slate-200 bg-white lg:hidden dark:border-slate-800 dark:bg-slate-950">
        <div className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
          {links.map((l) => item(l, true))}
          {item(account, true)}
        </div>
      </nav>
      {/* Wide screens: a sidebar. */}
      <nav aria-label="Console" className="hidden w-56 shrink-0 flex-col gap-1 lg:flex">
        {links.map((l) => item(l, false))}
        <div className="my-2 border-t border-slate-200 dark:border-slate-800" />
        {item(account, false)}
      </nav>
    </>
  );
}

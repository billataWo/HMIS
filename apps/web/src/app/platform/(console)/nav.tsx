"use client";

import { Activity, Building2, CreditCard, History, Inbox, LayoutDashboard, Megaphone, Menu, Mic, PhoneCall, Receipt, Settings, UserCog, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type Count = "requests" | "payments" | "followUps" | "servers";
type Item = { href: string; label: string; icon: typeof Inbox; count?: Count; owner?: boolean };

/** The console's sections, grouped by the job: customers, money, the system itself. */
const GROUPS: { label: string | null; items: Item[] }[] = [
  { label: null, items: [{ href: "/platform", label: "Overview", icon: LayoutDashboard }] },
  {
    label: "Customers",
    items: [
      { href: "/platform/requests", label: "Requests", icon: Inbox, count: "requests" },
      { href: "/platform/clinics", label: "Clinics", icon: Building2 },
      { href: "/platform/follow-ups", label: "Follow-ups", icon: PhoneCall, count: "followUps" },
      { href: "/platform/announcements", label: "Announcements", icon: Megaphone },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/platform/billing", label: "Billing", icon: Receipt, count: "payments" },
      { href: "/platform/plans", label: "Plans", icon: CreditCard },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/platform/health", label: "Health", icon: Activity, count: "servers" },
      { href: "/platform/operators", label: "Operators", icon: Users, owner: true },
      { href: "/platform/voice", label: "Voice", icon: Mic },
      { href: "/platform/settings", label: "Settings", icon: Settings },
      { href: "/platform/history", label: "History", icon: History },
    ],
  },
];
const ACCOUNT: Item = { href: "/platform/account", label: "Your account", icon: UserCog };

/** What a badge counts, for screen readers. */
const COUNTED: Record<Count, string> = { requests: "waiting", payments: "to confirm", followUps: "due", servers: "servers offline" };

const isCurrent = (path: string, href: string) => (href === "/platform" ? path === href : path === href || path.startsWith(`${href}/`));

type Counts = Record<Count, number>;

function NavLink({ item, path, counts, onNavigate }: { item: Item; path: string; counts: Counts; onNavigate?: () => void }) {
  const current = isCurrent(path, item.href);
  const count = item.count ? counts[item.count] : 0;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={`relative flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        current
          ? "bg-brand-50 text-brand-800 before:absolute before:inset-y-2 before:-left-px before:w-0.5 before:rounded-full before:bg-brand-600 dark:bg-brand-950 dark:text-brand-200 dark:before:bg-brand-400"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      }`}
    >
      <item.icon aria-hidden className={`size-4 shrink-0 ${current ? "text-brand-700 dark:text-brand-300" : "text-slate-400"}`} />
      {item.label}
      {count > 0 && (
        <span
          className={`ml-auto rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white tabular-nums ${item.count === "servers" ? "bg-red-600" : "bg-amber-700"}`}
        >
          {count > 999 ? "999+" : count}
          <span className="sr-only"> {COUNTED[item.count!]}</span>
        </span>
      )}
    </Link>
  );
}

function Groups({ owner, counts, path, onNavigate }: { owner: boolean; counts: Counts; path: string; onNavigate?: () => void }) {
  return (
    <>
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => !i.owner || owner);
        return (
          <div key={g.label ?? "home"} className="space-y-0.5">
            {g.label && <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">{g.label}</p>}
            {items.map((i) => (
              <NavLink key={i.href} item={i} path={path} counts={counts} onNavigate={onNavigate} />
            ))}
          </div>
        );
      })}
      <div className="my-3 border-t border-slate-200 dark:border-slate-800" />
      <NavLink item={ACCOUNT} path={path} counts={counts} onNavigate={onNavigate} />
    </>
  );
}

/**
 * The console's sections. Wide screens: a sidebar, grouped. Phones and tablets: a bar with the
 * current section and a Menu button that opens the same list in a drawer (a dialog: Esc, the
 * backdrop or a link closes it). Badges: requests waiting, payments to confirm, follow-ups due,
 * clinic servers offline.
 */
export function ConsoleNav({ owner, counts, ready, variant }: { owner: boolean; counts: Counts; ready: boolean; variant: "bar" | "side" }) {
  const path = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const close = () => drawer.current?.close();
  // A navigation that did not come from a link in the drawer (back button) closes it too.
  useEffect(() => {
    drawer.current?.close();
  }, [path]);

  if (!ready) return null;
  const here = [...GROUPS.flatMap((g) => g.items), ACCOUNT].filter((i) => isCurrent(path, i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const waiting = Object.values(counts).some((n) => n > 0);

  if (variant === "side") {
    return (
      <nav aria-label="Console" className="flex w-56 shrink-0 flex-col">
        <Groups owner={owner} counts={counts} path={path} />
      </nav>
    );
  }
  return (
    <>
      {/* Phones and tablets */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 lg:hidden dark:border-slate-800 dark:bg-slate-950">
        <button
          type="button"
          onClick={() => drawer.current?.showModal()}
          aria-haspopup="dialog"
          className="relative flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
        >
          <Menu aria-hidden className="size-4" />
          Menu
          {waiting && <span aria-hidden className="absolute -top-1 -right-1 size-2.5 rounded-full bg-amber-600 ring-2 ring-white dark:ring-slate-950" />}
          {waiting && <span className="sr-only">(something needs you)</span>}
        </button>
        {here && (
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <here.icon aria-hidden className="size-4 shrink-0 text-brand-700 dark:text-brand-300" />
            <span className="truncate">{here.label}</span>
          </span>
        )}
      </div>
      <dialog
        ref={drawer}
        aria-label="Console menu"
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-white p-0 shadow-xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-[1px] open:flex open:flex-col dark:bg-slate-950 dark:text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <span className="font-semibold">HMIS platform</span>
          <button type="button" onClick={close} aria-label="Close the menu" className="grid size-10 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <nav aria-label="Console" className="flex-1 overflow-y-auto p-3">
          <Groups owner={owner} counts={counts} path={path} onNavigate={close} />
        </nav>
      </dialog>

    </>
  );
}

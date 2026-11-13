"use client";

import {
  CalendarDays,
  ChartColumn,
  FlaskConical,
  HeartPulse,
  House,
  Landmark,
  ListOrdered,
  LogOut,
  Menu,
  Package,
  Pill,
  Receipt,
  ScrollText,
  Send,
  Settings,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout, setLanguage } from "@/app/actions";
import { type Lang, tr } from "@/lib/i18n";
import type { Me, Role } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { DURATION, EASE } from "./motion";
import { OfflineAgent, OfflineChip } from "./offline-agent";
import { clearSnapshot } from "@/lib/offline/idb";
import { QuickFind, QuickFindButton } from "./quick-find";
import { canRegister, FRONT_DESK } from "@/lib/roles";

/** `feature`: shown only when the clinic's plan includes that module. */
type Item = { href: string; label: string; labelAm: string; icon: LucideIcon; roles?: Role[]; feature?: string };

const GROUPS: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/", label: "Home", labelAm: "መነሻ", icon: House }] },
  {
    title: "Front desk",
    items: [
      { href: "/queue", label: "Queue", labelAm: "ወረፋ", icon: ListOrdered },
      { href: "/appointments", label: "Appointments", labelAm: "ቀጠሮዎች", icon: CalendarDays },
      { href: "/patients", label: "Patients", labelAm: "ታካሚዎች", icon: Users },
    ],
  },
  {
    title: "Services",
    items: [
      { href: "/lab", label: "Lab", labelAm: "ላብራቶሪ", icon: FlaskConical, roles: ["ADMIN", "LAB_TECH"] },
      { href: "/pharmacy", label: "Pharmacy", labelAm: "ፋርማሲ", icon: Pill, roles: ["ADMIN", "PHARMACIST"] },
      { href: "/inventory", label: "Inventory", labelAm: "ክምችት", icon: Package, roles: ["ADMIN", "PHARMACIST"] },
      { href: "/referrals", label: "Referrals", labelAm: "ሪፈራሎች", icon: Send, roles: ["ADMIN", "DOCTOR", "NURSE"] },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/billing", label: "Billing", labelAm: "ክፍያ", icon: Receipt, roles: ["ADMIN", "CASHIER"] },
      { href: "/billing/payers", label: "Credit & insurance", labelAm: "ዱቤና መድን", icon: Landmark, roles: ["ADMIN", "CASHIER"], feature: "CREDIT" },
      { href: "/reports", label: "Reports", labelAm: "ሪፖርቶች", icon: ChartColumn, roles: ["ADMIN"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/users", label: "Staff", labelAm: "ሰራተኞች", icon: UserCog, roles: ["ADMIN"] },
      { href: "/settings", label: "Settings", labelAm: "ቅንብሮች", icon: Settings, roles: ["ADMIN"] },
      { href: "/audit", label: "Audit log", labelAm: "የኦዲት መዝገብ", icon: ScrollText, roles: ["ADMIN"] },
    ],
  },
];

function matches(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The most specific entry wins, so /billing/payers marks "Credit & insurance", not "Billing". */
function activeHref(pathname: string) {
  return GROUPS.flatMap((g) => g.items)
    .filter((i) => matches(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function Brand({ me }: { me: Me }) {
  return (
    <div className="flex items-center gap-3 px-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-700 text-white shadow-sm shadow-brand-900/20">
        <HeartPulse aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{me.tenant.name}</p>
        <p className="truncate text-xs text-slate-500">{me.tenant.nameAm ?? "Clinic management"}</p>
      </div>
    </div>
  );
}

/** `layoutGroup` keeps the desktop and mobile active markers from animating into each other. */
function NavLinks({ me, lang, layoutGroup, onNavigate }: { me: Me; lang: Lang; layoutGroup: string; onNavigate?: () => void }) {
  const current = activeHref(usePathname());
  return (
    <nav aria-label="Main" className="space-y-5">
      {GROUPS.map((g, gi) => {
        const items = g.items.filter((i) => (!i.roles || i.roles.includes(me.role)) && (!i.feature || !me.features || me.features.includes(i.feature)));
        if (items.length === 0) return null;
        return (
          <div key={g.title ?? gi}>
            {g.title && <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{tr(lang, g.title)}</p>}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = item.href === current;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                        active
                          ? "text-brand-800 dark:text-white"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white"
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId={`nav-active-${layoutGroup}`}
                          className="absolute inset-0 rounded-lg bg-brand-50 ring-1 ring-brand-600/15 dark:bg-brand-500/15 dark:ring-brand-400/20"
                          transition={{ type: "spring", stiffness: 500, damping: 40 }}
                        />
                      )}
                      <Icon
                        aria-hidden
                        className={`relative size-4.5 shrink-0 ${active ? "text-brand-700 dark:text-brand-300" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"}`}
                      />
                      <span className="relative flex-1 truncate">{lang === "am" ? item.labelAm : item.label}</span>
                      <span className="relative text-xs font-normal text-slate-500">{lang === "am" ? item.label : item.labelAm}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function LanguageSwitch({ lang }: { lang: Lang }) {
  const option = (value: Lang, label: string) => (
    <form action={setLanguage.bind(null, value)}>
      <button
        aria-pressed={lang === value}
        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${lang === value ? "bg-brand-700 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800"}`}
      >
        {label}
      </button>
    </form>
  );
  return (
    <div className="mb-2 flex items-center justify-between px-1" aria-label="Language">
      <span className="text-xs text-slate-500">{tr(lang, "Language")}</span>
      <div className="flex gap-1">
        {option("en", "English")}
        {option("am", "አማርኛ")}
      </div>
    </div>
  );
}

function UserCard({ me, lang }: { me: Me; lang: Lang }) {
  return (
    <>
    <OfflineChip />
    <LanguageSwitch lang={lang} />
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        {initials(me.fullName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{me.fullName}</p>
        <p className="truncate text-xs text-slate-500">
          {ROLE_LABELS[me.role]} ·{" "}
          <Link href="/account/password" className="hover:text-brand-700 hover:underline">
            {tr(lang, "Password")}
          </Link>{" "}
          ·{" "}
          <Link href="/account/two-step" className="hover:text-brand-700 hover:underline">
            {tr(lang, "Two-step")}
          </Link>
        </p>
      </div>
      {/* Signing out removes this user's patient data from the browser; unsent work stays. */}
      <form action={logout} onSubmit={() => void clearSnapshot().catch(() => undefined)}>
        <button
          aria-label={tr(lang, "Sign out")}
          title={tr(lang, "Sign out")}
          className="grid size-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <LogOut aria-hidden className="size-4" />
        </button>
      </form>
    </div>
    </>
  );
}

export function AppNav({ me, lang }: { me: Me; lang: Lang }) {
  const [open, setOpen] = useState(false);

  // Links close the menu themselves; Escape and the backdrop close it too.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <OfflineAgent me={me} />
      <QuickFind frontDesk={FRONT_DESK.includes(me.role)} canRegister={canRegister(me)} />
      {/* Phones and tablets: top bar with a slide-in menu. */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/85 px-4 py-2.5 backdrop-blur-md md:hidden print:hidden dark:border-slate-800 dark:bg-slate-950/85">
        <Brand me={me} />
        <span className="ml-auto" />
        <QuickFindButton variant="icon" />
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="grid size-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Menu aria-hidden className="size-5" />
        </button>
      </header>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 md:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <motion.div
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-6 overflow-y-auto bg-slate-50 p-4 shadow-overlay dark:bg-slate-950"
              initial={{ x: "-100%" }}
              animate={{ x: 0, transition: { duration: 0.28, ease: EASE } }}
              exit={{ x: "-100%", transition: { duration: 0.2, ease: EASE } }}
            >
              <div className="flex items-center justify-between">
                <Brand me={me} />
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>
              <NavLinks me={me} lang={lang} layoutGroup="mobile" onNavigate={() => setOpen(false)} />
              <div className="mt-auto">
                <UserCard me={me} lang={lang} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Desktop: fixed sidebar. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-slate-200 bg-slate-50/80 px-3 py-5 md:flex print:hidden dark:border-slate-800 dark:bg-slate-950">
        <Brand me={me} />
        <QuickFindButton variant="sidebar" />
        <NavLinks me={me} lang={lang} layoutGroup="desktop" />
        <div className="mt-auto">
          <UserCard me={me} lang={lang} />
        </div>
      </aside>
    </>
  );
}

export function AppNavSkeleton() {
  return (
    <>
      <div className="h-15.25 border-b border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-950" />
      <aside className="hidden h-screen w-64 shrink-0 flex-col gap-4 border-r border-slate-200 bg-slate-50/80 px-3 py-5 md:flex dark:border-slate-800 dark:bg-slate-950">
        <div className="shimmer h-9 rounded-xl" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="shimmer h-8 rounded-lg" />
        ))}
      </aside>
    </>
  );
}

import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cache, Suspense, type ReactNode } from "react";
import { ThemeSwitch } from "@/components/theme-switch";
import { type ConsoleCounts, platformApi, type OperatorMe } from "@/lib/platform";
import { ConsoleNav } from "./nav";
import { ConsoleSearch } from "./search";

/** Once per request, however many parts of the frame need it. */
const loadFrame = cache(async () => {
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  const ready = !me.mustChangePassword && me.twoStep.enabled;
  const counts = ready ? await platformApi<ConsoleCounts>("/platform/counts") : { pendingRequests: 0, pendingPayments: 0, followUpsDue: 0, serversOffline: 0 };
  return { me, ready, counts: { requests: counts.pendingRequests, payments: counts.pendingPayments, followUps: counts.followUpsDue, servers: counts.serversOffline } };
});

async function Operator() {
  const { me } = await loadFrame();
  const initials = me.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <Link href="/platform/account" className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-slate-100 dark:hover:bg-slate-800" title="Your account">
      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
        {initials || "?"}
      </span>
      <span className="hidden text-left leading-tight sm:block">
        <span className="block font-medium text-slate-900 dark:text-white">{me.fullName}</span>
        <span className="block text-xs text-slate-500 capitalize">{me.role.toLowerCase()}</span>
      </span>
    </Link>
  );
}

/** The search box, once the operator has finished setting up their sign-in. */
async function Search() {
  const { ready } = await loadFrame();
  return ready ? <ConsoleSearch /> : null;
}

async function Nav() {
  const { me, ready, counts } = await loadFrame();
  return <ConsoleNav owner={me.role === "OWNER"} counts={counts} ready={ready} />;
}

/** The platform console: HMIS staff only, separate from every clinic's screens. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-slate-50/60 dark:bg-transparent">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900 focus:shadow"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/platform" className="flex items-center gap-2.5 font-semibold text-slate-900 dark:text-white">
            <span className="grid size-8 place-items-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <ShieldCheck aria-hidden className="size-4" />
            </span>
            HMIS platform
            <span className="hidden rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 sm:inline dark:bg-slate-800 dark:text-slate-300">
              HMIS team only
            </span>
          </Link>
          <div className="hidden flex-1 justify-center px-2 md:flex">
            <Suspense fallback={null}>
              <Search />
            </Suspense>
          </div>
          <div className="ml-auto flex items-center justify-end gap-1 text-sm sm:min-w-56 md:ml-0">
            <ThemeSwitch label="Theme" day="Day" dark="Dark" className="mr-1" />
            <Suspense fallback={<span aria-hidden className="h-10 w-10 rounded-lg sm:w-44" />}>
              <Operator />
            </Suspense>
            <a
              href="/platform/signout"
              className="flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOut aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">Sign out</span>
            </a>
          </div>
        </div>
      </header>
      <div className="lg:hidden">
        <Suspense fallback={<div className="h-14 border-b border-slate-200 dark:border-slate-800" />}>
          <Nav />
        </Suspense>
        {/* Phones: the search box under the tabs. */}
        <div className="border-b border-slate-200 bg-white px-4 py-2 md:hidden dark:border-slate-800 dark:bg-slate-950">
          <Suspense fallback={null}>
            <Search />
          </Suspense>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-6 sm:px-6 lg:py-8">
        <aside className="hidden lg:block">
          <div className="sticky top-22">
            <Suspense fallback={<div className="w-56" />}>
              <Nav />
            </Suspense>
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

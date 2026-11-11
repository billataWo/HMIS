import { Building2, ChevronRight, Search, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { secondaryButtonClass, EmptyState, Input, PageHeader, Skeleton } from "@/components/ui";
import type { SubscriptionState } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import { type ClinicRow, DEPLOYMENT_LABEL, platformApi } from "@/lib/platform";
import { date, StateBadge, thClass } from "../bits";

const FILTERS: { value: SubscriptionState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "overdue", label: "Overdue" },
  { value: "suspended", label: "Suspended" },
  { value: "cancelled", label: "Cancelled" },
];

const until = (c: ClinicRow) => (c.subscription?.endsAt ? date(c.subscription.endsAt) : c.subscription ? "No end date" : "Not billed");

async function List({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const state = FILTERS.some((f) => f.value === params.state) ? (params.state as SubscriptionState | "all") : "all";
  const all = await platformApi<ClinicRow[]>(`/platform/clinics${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const count = (s: string) => (s === "all" ? all.length : all.filter((c) => c.subscription?.state === s).length);
  const clinics = state === "all" ? all : all.filter((c) => c.subscription?.state === state);
  const href = (s: string) => `/platform/clinics?${new URLSearchParams({ ...(q && { q }), ...(s !== "all" && { state: s }) })}`;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form role="search" className="flex w-full gap-2 lg:max-w-sm">
          {state !== "all" && <input type="hidden" name="state" value={state} />}
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={q} placeholder="Search by clinic name" aria-label="Search clinics" className="w-full pl-9" />
          </div>
          <button className={secondaryButtonClass}>Search</button>
        </form>
        <nav aria-label="Filter by status" className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => {
            const on = state === f.value;
            const n = count(f.value);
            if (f.value !== "all" && n === 0 && !on) return null;
            return (
              <Link
                key={f.value}
                href={href(f.value)}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-colors ring-inset ${
                  on
                    ? "bg-brand-700 text-white ring-brand-700 dark:bg-brand-700 dark:ring-brand-700"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                {f.label}
                <span className={`text-xs tabular-nums ${on ? "text-white/80" : "text-slate-500"}`}>{n}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {!clinics.length ? (
        <EmptyState icon={Building2} title={q ? `No clinic matches “${q}”` : "No clinics here yet"}>
          {q || state !== "all" ? (
            <Link href="/platform/clinics" className="font-medium text-brand-700 hover:underline dark:text-brand-400">
              Show all clinics
            </Link>
          ) : (
            "Clinics appear here when you approve their requests."
          )}
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {clinics.map((c) => (
              <li key={c.id}>
                <Link href={`/platform/clinics/${c.id}`} className="surface block p-4 hover:border-brand-300 dark:hover:border-brand-700">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white">{c.name}</p>
                      {c.nameAm && <p className="text-xs text-slate-500">{c.nameAm}</p>}
                    </div>
                    {c.subscription && <StateBadge state={c.subscription.state} />}
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {c.subscription ? `${c.subscription.plan.name} · ${DEPLOYMENT_LABEL[c.subscription.deployment]} · ${c.subscription.endsAt ? `until ${until(c)}` : "no end date"}` : "Not billed"}
                  </p>
                  <p className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Users aria-hidden className="size-3.5" /> {c.staff} staff
                    </span>
                    <span>{c.patients} patients</span>
                    <span>{c.lastActivityAt ? `active ${formatAgo(c.lastActivityAt)}` : "never used"}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="surface hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={thClass}>Clinic</th>
                  <th className={thClass}>Plan</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Until</th>
                  <th className={`${thClass} text-right`}>Staff</th>
                  <th className={`${thClass} text-right`}>Patients</th>
                  <th className={thClass}>Last activity</th>
                  <th className={thClass}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {clinics.map((c) => (
                  <tr key={c.id} className="relative transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <td className="px-3 py-3 align-top">
                      <Link
                        href={`/platform/clinics/${c.id}`}
                        className="font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-600 focus-visible:after:ring-inset dark:text-white"
                      >
                        {c.name}
                      </Link>
                      {c.nameAm && <p className="text-xs text-slate-500">{c.nameAm}</p>}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {c.subscription ? (
                        <>
                          {c.subscription.plan.name}
                          <p className="text-xs text-slate-500">{DEPLOYMENT_LABEL[c.subscription.deployment]}</p>
                        </>
                      ) : (
                        <span className="text-slate-500">Not billed</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">{c.subscription && <StateBadge state={c.subscription.state} />}</td>
                    <td className="px-3 py-3 align-top whitespace-nowrap">
                      {until(c)}
                      {c.subscription?.daysLeft != null && c.subscription.daysLeft <= 7 && c.subscription.daysLeft >= 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          {c.subscription.daysLeft} day{c.subscription.daysLeft === 1 ? "" : "s"} left
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right align-top tabular-nums">{c.staff}</td>
                    <td className="px-3 py-3 text-right align-top tabular-nums">{c.patients}</td>
                    <td className="px-3 py-3 align-top whitespace-nowrap text-slate-600 dark:text-slate-300">{c.lastActivityAt ? formatAgo(c.lastActivityAt) : "Never"}</td>
                    <td className="px-3 py-3 align-top text-slate-500">
                      <ChevronRight aria-hidden className="size-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function ClinicsPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  return (
    <>
      <PageHeader title="Clinics" subtitle="Every clinic on the HMIS cloud, with its plan and where its subscription stands." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

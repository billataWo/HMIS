import type { Metadata } from "next";
import { Building2, ChevronRight, Download, Moon, Search, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { secondaryButtonClass, EmptyState, Input, inputClass, PageHeader, Skeleton } from "@/components/ui";
import type { SubscriptionState } from "@/lib/api";
import { etb, formatAgo } from "@/lib/format";
import { type ClinicRow, DEPLOYMENT_LABEL, platformApi } from "@/lib/platform";
import { date, StateBadge, thClass, Pager, PAGE_SIZE, pageOf } from "../bits";

export const metadata: Metadata = { title: "Clinics" };

const FILTERS: { value: SubscriptionState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "overdue", label: "Overdue" },
  { value: "suspended", label: "Suspended" },
  { value: "cancelled", label: "Cancelled" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name" },
  { value: "mrr", label: "Revenue" },
  { value: "ends", label: "Ending soonest" },
  { value: "quiet", label: "Least used" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);
const ORDER: Record<Sort, (a: ClinicRow, b: ClinicRow) => number> = {
  newest: (a, b) => time(b.createdAt) - time(a.createdAt),
  name: (a, b) => a.name.localeCompare(b.name),
  mrr: (a, b) => Number(b.mrr) - Number(a.mrr) || a.name.localeCompare(b.name),
  // No end date last.
  ends: (a, b) => (time(a.subscription?.endsAt) || Infinity) - (time(b.subscription?.endsAt) || Infinity),
  quiet: (a, b) => a.visits30 - b.visits30 || time(a.lastActivityAt) - time(b.lastActivityAt),
};

/** A clinic still with HMIS that has not used it for two weeks: likely to leave, worth a call. */
const quiet = (c: ClinicRow) => c.subscription?.state !== "cancelled" && Date.now() - time(c.lastActivityAt) > 14 * 86_400_000;

const until = (c: ClinicRow) => (c.subscription?.endsAt ? date(c.subscription.endsAt) : c.subscription ? "No end date" : "Not billed");

async function List({ searchParams }: { searchParams: Promise<{ q?: string; state?: string; sort?: string; page?: string }> }) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const state = FILTERS.some((f) => f.value === params.state) ? (params.state as SubscriptionState | "all") : "all";
  const sort: Sort = SORTS.some((x) => x.value === params.sort) ? (params.sort as Sort) : "newest";
  const all = await platformApi<ClinicRow[]>(`/platform/clinics${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const count = (s: string) => (s === "all" ? all.length : all.filter((c) => c.subscription?.state === s).length);
  const clinics = (state === "all" ? all : all.filter((c) => c.subscription?.state === state)).toSorted(ORDER[sort]);
  const href = (s: string) => `/platform/clinics?${new URLSearchParams({ ...(q && { q }), ...(s !== "all" && { state: s }), ...(sort !== "newest" && { sort }) })}`;
  const mrr = clinics.reduce((sum, c) => sum + Number(c.mrr), 0);
  const page = pageOf(params.page, clinics.length);
  const shown = clinics.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => `/platform/clinics?${new URLSearchParams({ ...(q && { q }), ...(state !== "all" && { state }), ...(sort !== "newest" && { sort }), ...(p > 1 && { page: String(p) }) })}`;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form role="search" className="flex w-full flex-wrap gap-2 lg:max-w-xl lg:flex-nowrap">
          {state !== "all" && <input type="hidden" name="state" value={state} />}
          <div className="relative min-w-48 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={q} placeholder="Clinic name or phone" aria-label="Search clinics" className="w-full pl-9" />
          </div>
          <select name="sort" defaultValue={sort} aria-label="Sort" className={`${inputClass} w-auto`}>
            {SORTS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          <button className={secondaryButtonClass}>Show</button>
          <a href={`/platform/clinics/csv${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={`${secondaryButtonClass} gap-2`} title="Download every clinic as a spreadsheet">
            <Download aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">CSV</span>
          </a>
        </form>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
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
            {shown.map((c) => (
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
                      <Users aria-hidden className="size-3.5" /> {c.staff}
                      {c.subscription?.plan.maxStaff ? ` / ${c.subscription.plan.maxStaff}` : ""} staff
                    </span>
                    <span>{c.visits30} visits in 30 days</span>
                    <span className={quiet(c) ? "font-medium text-amber-700 dark:text-amber-300" : ""}>{c.lastActivityAt ? `active ${formatAgo(c.lastActivityAt)}` : "never used"}</span>
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
                  <th className={`${thClass} text-right`}>A month</th>
                  <th className={`${thClass} text-right`}>Staff</th>
                  <th className={`${thClass} text-right`}>Visits, 30 days</th>
                  <th className={thClass}>Last activity</th>
                  <th className={thClass}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {shown.map((c) => (
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
                    <td className="px-3 py-3 text-right align-top whitespace-nowrap tabular-nums">{Number(c.mrr) ? etb(c.mrr) : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-3 text-right align-top tabular-nums">
                      <span className={c.subscription?.plan.maxStaff && c.staff >= c.subscription.plan.maxStaff ? "font-medium text-amber-700 dark:text-amber-300" : ""}>{c.staff}</span>
                      {c.subscription?.plan.maxStaff ? <span className="text-slate-400"> / {c.subscription.plan.maxStaff}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right align-top tabular-nums">
                      {c.visits30}
                      <p className="text-xs text-slate-500">{c.patients} patients</p>
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {c.lastActivityAt ? formatAgo(c.lastActivityAt) : "Never"}
                      {quiet(c) && (
                        <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                          <Moon aria-hidden className="size-3" /> quiet: call them
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-slate-500">
                      <ChevronRight aria-hidden className="size-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-medium dark:border-slate-800 dark:bg-slate-900/60">
                <tr>
                  <td className="px-3 py-2.5" colSpan={4}>
                    {clinics.length} clinic{clinics.length === 1 ? "" : "s"}{clinics.length > shown.length ? ", in all" : ""}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{etb(mrr)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
          <Pager page={page} total={clinics.length} href={pageHref} />
        </>
      )}
    </>
  );
}

export default function ClinicsPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string; sort?: string; page?: string }> }) {
  return (
    <>
      <PageHeader title="Clinics" subtitle="Every clinic on the HMIS cloud, with its plan and where its subscription stands." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

import type { Metadata } from "next";
import { ChevronRight, Inbox, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { formatAgo } from "@/lib/format";
import { type ClinicRequest, DEPLOYMENT_LABEL, platformApi } from "@/lib/platform";
import { dateTime, thClass } from "../bits";

export const metadata: Metadata = { title: "Requests" };

const STATUS = { PENDING: { label: "Waiting", tone: "warning" }, APPROVED: { label: "Approved", tone: "success" }, REJECTED: { label: "Rejected", tone: "neutral" } } as const;
const TABS = [
  { value: "PENDING", label: "Waiting" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
] as const;

async function Requests({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const raw = (await searchParams).status;
  const status = TABS.some((t) => t.value === raw) ? (raw as (typeof TABS)[number]["value"]) : raw === "" ? "ALL" : "PENDING";
  const all = await platformApi<ClinicRequest[]>("/platform/requests");
  const count = (s: string) => (s === "ALL" ? all.length : all.filter((r) => r.status === s).length);
  const shown = status === "ALL" ? all : all.filter((r) => r.status === status);

  return (
    <>
      <nav aria-label="Filter requests" className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 sm:w-fit dark:bg-slate-800/70">
        {TABS.map((t) => {
          const on = status === t.value;
          return (
            <Link
              key={t.value}
              href={`/platform/requests?status=${t.value}`}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                on ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] leading-none tabular-nums ${
                  t.value === "PENDING" && count(t.value) > 0 ? "bg-amber-700 text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                {count(t.value)}
              </span>
            </Link>
          );
        })}
      </nav>

      {!shown.length ? (
        <EmptyState icon={Inbox} title={status === "PENDING" ? "Nothing is waiting" : "No requests here"}>
          {status === "PENDING" ? "New requests from the front page appear here. Each one waits for your call and decision." : null}
        </EmptyState>
      ) : (
        <>
          {/* Phones: one card per request. */}
          <ul className="space-y-3 md:hidden">
            {shown.map((r) => (
              <li key={r.id}>
                <Link href={`/platform/requests/${r.id}`} className="surface block p-4 hover:border-brand-300 dark:hover:border-brand-700">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white">{r.clinicName}</p>
                      <p className="font-mono text-xs text-slate-500">{r.reference}</p>
                    </div>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <div className="flex items-center gap-2">
                      <MapPin aria-hidden className="size-4 text-slate-400" />
                      <dt className="sr-only">Where</dt>
                      <dd>
                        {r.city}, {r.region}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone aria-hidden className="size-4 text-slate-400" />
                      <dt className="sr-only">Contact</dt>
                      <dd>
                        {r.contactName} · {r.contactPhone}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-slate-500">
                    {r.planCode ?? "Plan not chosen"} · {DEPLOYMENT_LABEL[r.deployment]} · {formatAgo(r.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table; the whole row opens the request. */}
          <div className="surface hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={thClass}>Clinic</th>
                  <th className={thClass}>Where</th>
                  <th className={thClass}>Contact</th>
                  <th className={thClass}>Wants</th>
                  <th className={thClass}>Sent</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {shown.map((r) => (
                  <tr key={r.id} className="relative transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <td className="px-3 py-3 align-top">
                      <Link href={`/platform/requests/${r.id}`} className="font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-600 focus-visible:after:ring-inset dark:text-white">
                        {r.clinicName}
                      </Link>
                      <p className="font-mono text-xs text-slate-500">{r.reference}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {r.city}
                      <p className="text-xs text-slate-500">{r.region}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {r.contactName}
                      <p className="text-xs text-slate-500 tabular-nums">{r.contactPhone}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {r.planCode ?? "Not sure"}
                      <p className="text-xs text-slate-500">
                        {DEPLOYMENT_LABEL[r.deployment]}
                        {r.staffCount ? ` · ${r.staffCount} staff` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap" title={dateTime(r.createdAt)}>
                      {formatAgo(r.createdAt)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </td>
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

export default function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <>
      <PageHeader title="Requests" subtitle="Clinics asking to use HMIS. Call each one, then approve or reject." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </>
  );
}

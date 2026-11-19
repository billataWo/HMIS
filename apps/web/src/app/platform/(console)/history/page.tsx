import type { Metadata } from "next";
import { Download, X } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, inputClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { CLINIC_TZ } from "@/lib/format";
import { type HistoryEntry, type OperatorMe, type OperatorRow, platformApi } from "@/lib/platform";
import { ActivityList, AREAS } from "../activity";

export const metadata: Metadata = { title: "History" };

type Params = { area?: string; operatorId?: string; tenantId?: string; before?: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: CLINIC_TZ });

/** The filters as a query string (only those set). */
const query = (p: Params) => {
  const q = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
  return q.size ? `?${q}` : "";
};

async function Content({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const filters: Params = {
    area: AREAS.some((a) => a.value === raw.area) ? raw.area : undefined,
    operatorId: raw.operatorId || undefined,
    tenantId: raw.tenantId || undefined,
  };
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  const [entries, operators] = await Promise.all([
    platformApi<HistoryEntry[]>(`/platform/audit${query({ ...filters, before: raw.before })}`),
    me.role === "OWNER" ? platformApi<OperatorRow[]>("/platform/operators") : Promise.resolve([]),
  ]);
  const clinicName = filters.tenantId ? (entries.find((e) => e.tenantId === filters.tenantId)?.clinic ?? "this clinic") : null;
  const days = new Map<string, HistoryEntry[]>();
  for (const e of entries) days.set(day(e.createdAt), [...(days.get(day(e.createdAt)) ?? []), e]);
  const filtered = !!(filters.area || filters.operatorId || filters.tenantId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <form className="flex flex-wrap items-end gap-2">
          {filters.tenantId && <input type="hidden" name="tenantId" value={filters.tenantId} />}
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            Kind
            <select name="area" defaultValue={filters.area ?? ""} className={`${inputClass} w-auto min-w-48`}>
              <option value="">Everything</option>
              {AREAS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          {operators.length > 0 && (
            <label className="grid gap-1 text-xs font-medium text-slate-500">
              Operator
              <select name="operatorId" defaultValue={filters.operatorId ?? ""} className={`${inputClass} w-auto min-w-44`}>
                <option value="">Anyone</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.fullName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className={secondaryButtonClass}>Show</button>
          {filtered && (
            <Link href="/platform/history" className="inline-flex min-h-10 items-center px-2 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
              Clear
            </Link>
          )}
        </form>
        <a href={`/platform/history/csv${query(filters)}`} className={`${secondaryButtonClass} gap-2`}>
          <Download aria-hidden className="size-4" /> Download CSV
        </a>
      </div>

      {clinicName && (
        <p className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200">
            Clinic: {clinicName}
            <Link href={`/platform/history${query({ ...filters, tenantId: undefined })}`} aria-label="Show every clinic" className="rounded-full hover:bg-brand-100 dark:hover:bg-brand-900">
              <X aria-hidden className="size-3.5" />
            </Link>
          </span>
        </p>
      )}

      {!entries.length ? (
        <EmptyState title={raw.before ? "Nothing older" : filtered ? "Nothing matches" : "Nothing yet"}>
          {raw.before ? (
            <Link href={`/platform/history${query(filters)}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
              Back to the newest
            </Link>
          ) : (
            "Every action in this console and every operator sign-in is recorded here."
          )}
        </EmptyState>
      ) : (
        [...days].map(([d, list]) => (
          <Card key={d} title={d} description={`${list.length} action${list.length === 1 ? "" : "s"}`}>
            <ActivityList entries={list} />
          </Card>
        ))
      )}

      {entries.length > 0 && (
        <nav aria-label="Older and newer" className="flex items-center justify-center gap-3 text-sm">
          {raw.before && (
            <Link href={`/platform/history${query(filters)}`} className={secondaryButtonClass}>
              Newest
            </Link>
          )}
          {entries.length === 200 ? (
            <Link href={`/platform/history${query({ ...filters, before: entries[entries.length - 1].id })}`} className={secondaryButtonClass}>
              Older
            </Link>
          ) : (
            <span className="text-xs text-slate-500">That is everything{filtered ? " that matches" : ""}.</span>
          )}
        </nav>
      )}
    </div>
  );
}

export default function HistoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <PageHeader title="History" subtitle="Every action in this console and every operator sign-in, newest first." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

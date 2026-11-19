import { CalendarCheck, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { clinicToday, etb } from "@/lib/format";
import { type FollowUps, platformApi } from "@/lib/platform";
import { NoteItem } from "../notes";

export const metadata: Metadata = { title: "Follow-ups" };

type Params = { scope?: string; mine?: string };
const SCOPES = [
  { value: "due", label: "Due" },
  { value: "upcoming", label: "Coming up" },
  { value: "done", label: "Done" },
] as const;

async function Content({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const scope = SCOPES.find((s) => s.value === raw.scope)?.value ?? "due";
  const mine = raw.mine === "1";
  const query = new URLSearchParams({ ...(scope !== "due" && { scope }), ...(mine && { mine: "1" }) });
  const { summary, notes } = await platformApi<FollowUps>(`/platform/follow-ups${query.size ? `?${query}` : ""}`);
  await connection();
  const today = clinicToday();
  const href = (s: string, m: boolean) => {
    const p = new URLSearchParams({ ...(s !== "due" && { scope: s }), ...(m && { mine: "1" }) });
    return `/platform/follow-ups${p.size ? `?${p}` : ""}`;
  };
  const count = (s: string) => (s === "due" ? (mine ? summary.dueMine : summary.due) : s === "upcoming" && !mine ? summary.upcoming : null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Which follow-ups" className="flex gap-1 overflow-x-auto">
          {SCOPES.map((s) => {
            const on = scope === s.value;
            const n = count(s.value);
            return (
              <Link
                key={s.value}
                href={href(s.value, mine)}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-colors ring-inset ${
                  on
                    ? "bg-brand-700 text-white ring-brand-700"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                {s.label}
                {n !== null && <span className={`text-xs tabular-nums ${on ? "text-white/80" : s.value === "due" && n ? "font-semibold text-amber-700 dark:text-amber-300" : "text-slate-500"}`}>{n}</span>}
              </Link>
            );
          })}
        </nav>
        <Link
          href={href(scope, !mine)}
          aria-pressed={mine}
          className={`flex min-h-9 items-center rounded-full px-3 text-sm font-medium ring-1 ring-inset ${
            mine ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"
          }`}
        >
          {mine ? "Only mine ✓" : "Only mine"}
        </Link>
      </div>

      {!notes.length ? (
        <EmptyState icon={CalendarCheck} title={scope === "due" ? "Nothing to follow up today" : scope === "upcoming" ? "Nothing planned" : "Nothing done yet"}>
          On a clinic&apos;s page, note a call or a promise to pay with a follow-up day: it comes here on that day.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="surface px-4 py-1 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-100 py-2.5 dark:border-slate-800">
                <Link href={`/platform/clinics/${n.clinic.id}`} className="font-semibold text-slate-900 hover:underline dark:text-white">
                  {n.clinic.name || "A clinic"}
                </Link>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {Number(n.owes) > 0 && (
                    <Link href={`/platform/billing?status=OPEN&q=${encodeURIComponent(n.clinic.name)}`} className="text-slate-600 hover:underline dark:text-slate-300">
                      owes <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{etb(n.owes)}</span>
                    </Link>
                  )}
                  {n.clinic.phone && (
                    <a href={`tel:${n.clinic.phone}`} className="inline-flex min-h-9 items-center gap-1.5 font-medium text-brand-700 tabular-nums hover:underline dark:text-brand-400">
                      <Phone aria-hidden className="size-4" /> {n.clinic.phone}
                    </a>
                  )}
                </span>
              </div>
              <ul>
                <NoteItem note={n} daysLate={n.daysLate} today={today} />
              </ul>
            </li>
          ))}
          {notes.length === 300 && <li className="text-sm text-slate-500">The first 300 are shown.</li>}
        </ul>
      )}
    </>
  );
}

export default function FollowUpsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Calls to make and promises to pay to check, from the notes on each clinic." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, FileSearch, TriangleAlert } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { PrintButton } from "@/components/print-button";
import { NoAccess } from "@/components/status-page";
import { buttonClass, EmptyState, inputClass, pillClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Me, type ReportResult, type StaffUser } from "@/lib/api";
import { clinicToday, formatDualDate, shiftDay } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { numeric, showCell, sortRows } from "@/lib/report-format";
import { CATEGORIES, reportByKey, type ReportDef } from "@/lib/reports";

type Search = Record<string, string | string[] | undefined>;

/** Rows on one screen; more go on further pages (the CSV always has them all). */
const PAGE = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The usual periods: real report screens start from the month so far. */
function presets(today: string): [string, string, string][] {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDay(monthStart, -1);
  return [
    ["Today", today, today],
    ["Yesterday", shiftDay(today, -1), shiftDay(today, -1)],
    ["Last 7 days", shiftDay(today, -6), today],
    ["This month", monthStart, today],
    ["Last month", `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
    ["Last 90 days", shiftDay(today, -89), today],
    ["This year", `${today.slice(0, 4)}-01-01`, today],
  ];
}

const period = (from: string, to: string) =>
  from === to ? formatDualDate(`${from}T12:00:00+03:00`) : `${formatDualDate(`${from}T12:00:00+03:00`)} – ${formatDualDate(`${to}T12:00:00+03:00`)}`;

async function Report({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Search> }) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  await connection(); // "today" is the request's
  const def = reportByKey(key);
  if (!def) notFound();
  const t = await getT();
  const today = clinicToday();
  const from = DAY.test(one(sp.from) ?? "") ? one(sp.from)! : `${today.slice(0, 8)}01`;
  const to = DAY.test(one(sp.to) ?? "") ? one(sp.to)! : today;

  // The report's own filters, as chosen (or their starting value).
  const filters: Record<string, string> = {};
  for (const f of def.filters ?? []) {
    const v = one(sp[f.name]) ?? f.initial;
    if (v) filters[f.name] = v;
  }
  const query = new URLSearchParams({ from, to, ...filters });

  let me: Me;
  let result: ReportResult;
  let doctors: StaffUser[] = [];
  try {
    [me, result, doctors] = await Promise.all([
      api<Me>("/auth/me"),
      api<ReportResult>(`/reports/library/${key}?${query}`),
      def.filters?.some((f) => f.name === "doctorId") ? api<StaffUser[]>("/users").then((us) => us.filter((u) => u.role === "DOCTOR")) : Promise.resolve([]),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only clinic admins can see reports.")}</NoAccess>;
    if (e instanceof ApiError && e.status === 400) {
      return (
        <>
          <PageTitle title={def.title} />
          <p className="text-sm text-red-700 dark:text-red-400">{t(e.message)}</p>
        </>
      );
    }
    throw e;
  }

  // Sorting and paging happen here, over the whole result, so the totals stay the period's.
  const sortCol = def.columns.find((c) => c.key === one(sp.sort));
  const dir = one(sp.dir) === "desc" ? "desc" : "asc";
  const rows = sortCol ? sortRows(result.rows, sortCol, dir) : result.rows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(one(sp.page)) || 1));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  /** A link to this report with some settings changed (and back to the first page). */
  const href = (change: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ from, to, ...filters, sort: sortCol?.key, dir: sortCol ? dir : undefined, ...change })) if (v) next.set(k, v);
    return `/reports/${key}?${next}`;
  };
  const category = CATEGORIES.find((c) => c.key === def.category);
  const exportHref = `/reports/${key}/csv?${query}`;

  return (
    <>
      <nav aria-label={t("Breadcrumb")} className="mb-3 flex items-center gap-1.5 text-sm text-slate-500 print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 hover:text-brand-700 dark:hover:text-brand-300">
          <ArrowLeft aria-hidden className="size-3.5" />
          {t("Reports")}
        </Link>
        {category && <span aria-hidden>/</span>}
        {category && <span>{t(category.title)}</span>}
      </nav>
      <PageTitle
        title={def.title}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <a href={exportHref} download className={secondaryButtonClass}>
              <Download aria-hidden />
              {t("Download CSV")}
            </a>
            <PrintButton inline />
          </div>
        }
      />
      <p className="-mt-3 mb-5 max-w-3xl text-sm text-slate-600 print:hidden dark:text-slate-400">{t(def.description)}</p>

      {/* On paper: the clinic, the report, the period, and who printed it when. */}
      <div className="mb-4 hidden border-b border-slate-300 pb-3 text-sm print:block">
        <p className="text-base font-semibold">{me.tenant.name}</p>
        <p>
          {t(def.title)} · {def.asOfNow ? t("as of {time}", { time: formatDualDate(new Date().toISOString()) }) : period(from, to)}
        </p>
        <p className="text-xs text-slate-600">{t("Printed by {name} on {date}", { name: me.fullName, date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Addis_Ababa" }) })}</p>
      </div>

      <Filters def={def} from={from} to={to} today={today} filters={filters} doctors={doctors} href={href} t={t} />

      <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 text-sm print:hidden">
        <p className="text-slate-600 dark:text-slate-400">
          <span className="font-medium text-slate-900 dark:text-white">{t("{n} rows", { n: rows.length.toLocaleString("en-US") })}</span>
          {" · "}
          {def.asOfNow ? t("as of now") : period(from, to)}
        </p>
        {pages > 1 && <Pager page={page} pages={pages} total={rows.length} href={href} t={t} />}
      </div>

      {result.truncated && (
        <p className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {t("This period has more rows than one report holds. Choose a shorter period to see them all.")}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={FileSearch} title={t("Nothing to show")}>
          {def.asOfNow ? t("There is nothing in this report right now.") : t("Nothing in this period. Try a longer period or other filters.")}
        </EmptyState>
      ) : (
        <div className="surface overflow-hidden print:rounded-none print:border-0 print:shadow-none">
          <div className="max-h-[70vh] overflow-auto print:max-h-none print:overflow-visible">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-600 shadow-[inset_0_-1px_0] shadow-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:shadow-slate-800 print:static print:bg-white">
                <tr>
                  {def.columns.map((c) => {
                    const active = sortCol?.key === c.key;
                    const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                        className={`px-3 py-2.5 font-medium whitespace-nowrap ${numeric(c) ? "text-right" : ""}`}
                      >
                        <Link
                          href={href({ sort: c.key, dir: active && dir === "asc" ? "desc" : "asc", page: undefined })}
                          className={`group inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white ${numeric(c) ? "justify-end" : ""}`}
                        >
                          {t(c.label)}
                          {c.type === "money" && <span className="font-normal text-slate-400">{t("ETB")}</span>}
                          <Icon aria-hidden className={`size-3 print:hidden ${active ? "text-brand-700 dark:text-brand-300" : "opacity-0 group-hover:opacity-60"}`} />
                        </Link>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {shown.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 print:break-inside-avoid">
                    {def.columns.map((c) => (
                      <Td key={c.key} col={c} value={r[c.key]} t={t} />
                    ))}
                  </tr>
                ))}
              </tbody>
              {result.totals && (
                <tfoot className="sticky bottom-0 bg-slate-50 font-semibold text-slate-900 shadow-[inset_0_1px_0] shadow-slate-300 dark:bg-slate-900 dark:text-white dark:shadow-slate-700 print:static print:bg-white">
                  <tr>
                    {def.columns.map((c, i) => (
                      <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${numeric(c) ? "text-right" : ""}`}>
                        {i === 0 ? t("Total") : c.key in result.totals! ? showCell(c, result.totals![c.key], t) : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex justify-end print:hidden">
          <Pager page={page} pages={pages} total={rows.length} href={href} t={t} />
        </div>
      )}
      {pages > 1 && <p className="mt-2 hidden text-xs print:block">{t("Page {page} of {pages}. The CSV file has every row.", { page, pages })}</p>}
    </>
  );
}

function Td({ col, value, t }: { col: ReportDef["columns"][number]; value: string | number | null | undefined; t: T }) {
  const text = showCell(col, value, t);
  const empty = value === null || value === undefined || value === "";
  let tone = "";
  if (!empty && col.type === "days" && Number(value) < 0) tone = "font-medium text-red-700 dark:text-red-400";
  if (!empty && col.type === "money" && Number(value) < 0) tone = "text-red-700 dark:text-red-400";
  if (!empty && col.alert && Number(value) > 0) tone = "font-medium text-red-700 dark:text-red-400";
  if (!empty && col.type === "choice" && ["OUT", "HH", "LL", "LEFT_WITHOUT_BEING_SEEN", "NO_SHOW", "DID_NOT_GO", "REFUND", "REVERSAL", "EMERGENCY"].includes(String(value)))
    tone = "font-medium text-red-700 dark:text-red-400";
  if (!empty && col.type === "choice" && ["LOW", "H", "L", "URGENT", "OPEN"].includes(String(value))) tone = "font-medium text-amber-700 dark:text-amber-400";
  return (
    <td
      className={`px-3 py-2 align-top ${numeric(col) ? "text-right tabular-nums" : ""} ${col.wrap ? "min-w-48 max-w-sm" : "whitespace-nowrap"} ${col.type === "mono" ? "font-mono text-xs" : ""} ${empty ? "text-slate-400 dark:text-slate-600" : tone}`}
    >
      {text}
    </td>
  );
}

function Filters({
  def,
  from,
  to,
  today,
  filters,
  doctors,
  href,
  t,
}: {
  def: ReportDef;
  from: string;
  to: string;
  today: string;
  filters: Record<string, string>;
  doctors: StaffUser[];
  href: (c: Record<string, string | undefined>) => string;
  t: T;
}) {
  return (
    <div className="space-y-3 print:hidden">
      {!def.asOfNow && (
        <nav aria-label={t("Period")} className="flex flex-wrap gap-1.5">
          {presets(today).map(([label, f, until]) => (
            <Link key={label} href={href({ from: f, to: until, page: undefined })} aria-current={from === f && to === until ? "page" : undefined} className={pillClass(from === f && to === until)}>
              {t(label)}
            </Link>
          ))}
        </nav>
      )}
      <Form action={`/reports/${def.key}`} className="flex flex-wrap items-end gap-3 text-sm">
        {!def.asOfNow && (
          <>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">{t("From")}</span>
              <input type="date" name="from" defaultValue={from} max={today} className={`${inputClass} w-40`} />
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">{t("To")}</span>
              <input type="date" name="to" defaultValue={to} max={today} className={`${inputClass} w-40`} />
            </label>
          </>
        )}
        {(def.filters ?? []).map((f) => (
          <label key={f.name} className="space-y-1">
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">{t(f.label)}</span>
            <select name={f.name} defaultValue={filters[f.name] ?? ""} className={`${inputClass} w-52`}>
              {f.any && <option value="">{t(f.any)}</option>}
              {f.name === "doctorId"
                ? doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {t("Dr. {name}", { name: d.fullName })}
                    </option>
                  ))
                : f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.label)}
                    </option>
                  ))}
            </select>
          </label>
        ))}
        {(!def.asOfNow || (def.filters ?? []).length > 0) && <button className={buttonClass}>{t("Show")}</button>}
      </Form>
    </div>
  );
}

function Pager({ page, pages, total, href, t }: { page: number; pages: number; total: number; href: (c: Record<string, string | undefined>) => string; t: T }) {
  const first = (page - 1) * PAGE + 1;
  const last = Math.min(page * PAGE, total);
  const btn = "inline-flex size-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";
  return (
    <nav aria-label={t("Pages")} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      <span className="tabular-nums">{t("{first}–{last} of {total}", { first, last, total: total.toLocaleString("en-US") })}</span>
      {page > 1 ? (
        <Link href={href({ page: String(page - 1) })} className={btn} aria-label={t("Previous page")}>
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
      ) : (
        <span className={`${btn} pointer-events-none opacity-40`} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}
      {page < pages ? (
        <Link href={href({ page: String(page + 1) })} className={btn} aria-label={t("Next page")}>
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span className={`${btn} pointer-events-none opacity-40`} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}

function Loading() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-10 max-w-sm" />
      <Skeleton className="h-9 max-w-2xl" />
      <Skeleton className="h-96" />
    </div>
  );
}

export default function ReportPage({ params, searchParams }: PageProps<"/reports/[key]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Report params={params} searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}

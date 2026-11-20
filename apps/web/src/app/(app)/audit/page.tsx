import { connection } from "next/server";
import {
  Banknote,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Fingerprint,
  KeyRound,
  Monitor,
  Package,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Stethoscope,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { PrintButton } from "@/components/print-button";
import { NoAccess } from "@/components/status-page";
import { buttonClass, EmptyState, inputClass, pillClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type AuditEntry, type AuditIntegrity, type AuditPage, type StaffUser } from "@/lib/api";
import { actionLabel, AUDIT_CATEGORIES, type AuditCategory, deviceOf } from "@/lib/audit-actions";
import { CLINIC_TZ, clinicToday, formatDualDate, ROLE_LABELS, shiftDay } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";

type Search = { from?: string; to?: string; userId?: string; action?: string; category?: string; sensitive?: string; patientId?: string; q?: string; before?: string; verify?: string };
/** Wrong passwords: what the "Failed sign-ins" number opens. */
const FAILED_SIGN_IN = "auth.login_failed";
const KEYS: (keyof Search)[] = ["from", "to", "userId", "action", "category", "sensitive", "patientId", "q"];

const ICONS: Record<AuditCategory, LucideIcon> = { security: KeyRound, access: Eye, money: Banknote, clinical: Stethoscope, records: Users, stock: Package, settings: Settings };

function presets(today: string): [string, string, string][] {
  return [
    ["Today", today, today],
    ["Yesterday", shiftDay(today, -1), shiftDay(today, -1)],
    ["Last 7 days", shiftDay(today, -6), today],
    ["This month", `${today.slice(0, 8)}01`, today],
    ["Last 30 days", shiftDay(today, -29), today],
  ];
}

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: CLINIC_TZ });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ });
const dayHead = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: CLINIC_TZ });

/** "changedFields" → "changed fields". */
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();

/** A recorded value, short: lists joined, objects as compact JSON. */
function value(v: unknown): string {
  if (Array.isArray(v)) return v.every((x) => typeof x !== "object") ? v.join(", ") : JSON.stringify(v);
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function Log({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  await connection(); // "today" is the request's, not a prerender's
  const t = await getT();
  const today = clinicToday();
  const params = new URLSearchParams();
  for (const k of [...KEYS, "before" as const]) if (q[k]) params.set(k, q[k]!);
  let res: AuditPage;
  let staff: StaffUser[];
  let integrity: AuditIntegrity | null = null;
  try {
    [res, staff, integrity] = await Promise.all([
      api<AuditPage>(`/audit?${params}`),
      api<StaffUser[]>("/users"),
      q.verify ? api<AuditIntegrity>("/audit/integrity") : Promise.resolve(null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only clinic admins can see the audit log.")}</NoAccess>;
    if (e instanceof ApiError && e.status === 400) return <p className="text-sm text-red-700 dark:text-red-400">{t(e.message)}</p>;
    throw e;
  }

  /** This page's address with some filters changed (always back to the newest entries). */
  const href = (change: Partial<Search>) => {
    const next = new URLSearchParams();
    const merged: Partial<Search> = { from: res.from, to: res.to, ...Object.fromEntries(KEYS.map((k) => [k, q[k]])), ...change };
    for (const k of KEYS) if (merged[k]) next.set(k, merged[k]!);
    return `/audit?${next}`;
  };
  const older = new URLSearchParams(params);
  if (res.next) older.set("before", res.next);
  const exportQuery = new URLSearchParams(params);
  exportQuery.delete("before");
  exportQuery.set("from", res.from);
  exportQuery.set("to", res.to);
  const s = res.summary;

  // The entries by clinic day, newest first.
  const days: { day: string; entries: AuditEntry[] }[] = [];
  for (const e of res.entries) {
    const d = dayKey.format(new Date(e.createdAt));
    if (days.at(-1)?.day !== d) days.push({ day: d, entries: [] });
    days.at(-1)!.entries.push(e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <a href={`/audit/csv?${exportQuery}`} download className={secondaryButtonClass}>
          <Download aria-hidden />
          {t("Download CSV")}
        </a>
        <PrintButton inline />
      </div>

      <Seal seal={res.seal} integrity={integrity} verifyHref={`${href({})}&verify=1`} t={t} />

      {/* The period at a glance; each number opens what it counts. */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 print:hidden">
        <Stat label={t("Events")} value={s.total} href={href({ category: undefined, sensitive: undefined, action: undefined })} />
        <Stat label={t("Staff active")} value={s.people} />
        <Stat label={t("Need a second look")} value={s.sensitive} href={href({ sensitive: "1", category: undefined })} tone={s.sensitive ? "warn" : undefined} />
        <Stat label={t("Failed sign-ins")} value={s.failedSignIns} href={href({ action: FAILED_SIGN_IN, category: undefined, sensitive: undefined })} tone={s.failedSignIns ? "bad" : undefined} />
        <Stat label={t("Records opened")} value={s.recordViews} href={href({ category: "access", sensitive: undefined, action: undefined })} />
      </ul>

      {/* Groups. */}
      <nav aria-label={t("Area")} className="flex flex-wrap gap-1.5 print:hidden">
        <Link href={href({ category: undefined })} aria-current={!q.category ? "page" : undefined} className={pillClass(!q.category)}>
          {t("Everything")} <span className="ml-1 tabular-nums opacity-70">{s.total}</span>
        </Link>
        {AUDIT_CATEGORIES.map((c) => {
          const Icon = ICONS[c.key];
          const on = q.category === c.key;
          return (
            <Link key={c.key} href={href({ category: c.key, action: undefined })} aria-current={on ? "page" : undefined} title={t(c.description)} className={`${pillClass(on)} inline-flex items-center gap-1.5`}>
              <Icon aria-hidden className="size-3.5" />
              {t(c.label)}
              <span className="tabular-nums opacity-70">{s.byCategory[c.key] ?? 0}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 print:hidden">
        <nav aria-label={t("Period")} className="flex flex-wrap gap-1.5">
          {presets(today).map(([label, f, until]) => (
            <Link key={label} href={href({ from: f, to: until })} aria-current={res.from === f && res.to === until ? "page" : undefined} className={pillClass(res.from === f && res.to === until)}>
              {t(label)}
            </Link>
          ))}
        </nav>
        <Form action="/audit" className="surface flex flex-wrap items-end gap-3 p-4 text-sm">
          {q.category && <input type="hidden" name="category" value={q.category} />}
          {q.patientId && <input type="hidden" name="patientId" value={q.patientId} />}
          {q.action && <input type="hidden" name="action" value={q.action} />}
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-500">{t("From")}</span>
            <input type="date" name="from" defaultValue={res.from} max={today} className={`${inputClass} w-40`} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-500">{t("To")}</span>
            <input type="date" name="to" defaultValue={res.to} max={today} className={`${inputClass} w-40`} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-500">{t("Staff member")}</span>
            <select name="userId" defaultValue={q.userId ?? ""} className={`${inputClass} w-52`}>
              <option value="">{t("Everyone")}</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({t(ROLE_LABELS[u.role] ?? u.role)})
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-56 flex-1 space-y-1">
            <span className="block text-xs font-medium text-slate-500">{t("Search")}</span>
            <span className="relative block">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input type="search" name="q" defaultValue={q.q ?? ""} placeholder={t("MRN, invoice number or a word")} className={`${inputClass} w-full pl-9`} />
            </span>
          </label>
          <label className="flex items-center gap-2 pb-2.5">
            <input type="checkbox" name="sensitive" value="1" defaultChecked={!!q.sensitive} className="size-4 accent-brand-700" />
            <span>{t("Only what needs a second look")}</span>
          </label>
          <button className={buttonClass}>{t("Show")}</button>
        </Form>
      </div>

      {res.patient && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
          <Eye aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">
            {t("The history of {name} ({mrn}): every time their record was opened or changed.", { name: res.patient.name, mrn: res.patient.mrn })}
          </span>
          <Link href={href({ patientId: undefined, q: undefined })} className="inline-flex items-center gap-1 font-medium hover:underline print:hidden">
            <X aria-hidden className="size-3.5" />
            {t("Everyone's")}
          </Link>
        </p>
      )}
      {q.action && (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          {t("Only: {action}", { action: actionLabel(q.action) ? t(actionLabel(q.action)!) : q.action })}
          <Link href={href({ action: undefined })} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-300">
            <X aria-hidden className="size-3.5" />
            {t("Clear")}
          </Link>
        </p>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p className="text-slate-600 dark:text-slate-400">
          <span className="font-medium text-slate-900 dark:text-white">{t("{n} entries", { n: res.matching.toLocaleString("en-US") })}</span>
          {" · "}
          {res.from === res.to ? formatDualDate(`${res.from}T12:00:00+03:00`) : `${formatDualDate(`${res.from}T12:00:00+03:00`)} – ${formatDualDate(`${res.to}T12:00:00+03:00`)}`}
        </p>
        {q.before && (
          <Link href={href({})} className="text-brand-700 hover:underline dark:text-brand-300">
            {t("Back to the newest")}
          </Link>
        )}
      </div>

      {res.entries.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("Nothing recorded for these filters")} />
      ) : (
        <div className="space-y-6">
          {days.map((d) => (
            <section key={d.day} aria-label={dayHead.format(new Date(`${d.day}T12:00:00+03:00`))}>
              <h2 className="sticky top-0 z-10 mb-2 bg-[var(--canvas)]/95 py-1.5 text-xs font-semibold tracking-wider text-slate-500 uppercase backdrop-blur print:static">
                {formatDualDate(`${d.day}T12:00:00+03:00`)}
              </h2>
              <ol className="surface divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                {d.entries.map((e) => (
                  <Row key={e.id} e={e} t={t} patientHref={(id) => href({ patientId: id, q: undefined })} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
      {res.next && (
        <Link href={`/audit?${older}`} className={`${secondaryButtonClass} print:hidden`}>
          {t("Older entries")}
          <ChevronRight aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** One entry: when, who, what, about what; the rest (details, address, browser, seal) folded away. */
function Row({ e, t, patientHref }: { e: AuditEntry; t: T; patientHref: (id: string) => string }) {
  const Icon = ICONS[e.category ?? "clinical"];
  const label = actionLabel(e.action);
  const device = deviceOf(e.userAgent);
  const data = Object.entries(e.data ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const bad = e.action === "auth.login_failed" || e.action === "auth.locked" || e.action === "auth.two_step_failed";
  return (
    <li>
      <details className="group [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
          <span className="w-16 shrink-0 pt-0.5 font-mono text-xs text-slate-500 tabular-nums">{time.format(new Date(e.createdAt))}</span>
          <span
            aria-hidden
            className={`grid size-7 shrink-0 place-items-center rounded-lg ${
              bad
                ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                : e.sensitive
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-slate-900 dark:text-white">
              <span className="font-medium">{e.user ? e.user.fullName : t("System")}</span>
              {e.user && <span className="text-slate-500"> · {t(ROLE_LABELS[e.user.role] ?? e.user.role)}</span>}
              <span className="text-slate-400"> — </span>
              {label ? t(label) : <code className="font-mono text-xs">{e.action}</code>}
              {e.sensitive && (
                <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 align-[1px] text-[11px] font-medium ${bad ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400" : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"}`}>
                  <ShieldAlert aria-hidden className="size-3" />
                  {t("Second look")}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
              {e.target && (e.target.href ? <span className="text-slate-700 dark:text-slate-300">{e.target.label}</span> : <span>{e.target.label}</span>)}
              {device && (
                <span className="inline-flex items-center gap-1">
                  <Monitor aria-hidden className="size-3" />
                  {device}
                </span>
              )}
              {e.ip && <span className="font-mono">{e.ip}</span>}
            </span>
          </span>
          <ChevronDown aria-hidden className="mt-1 size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180 print:hidden" />
        </summary>
        <div className="space-y-3 border-t border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 pl-[7.5rem] text-xs dark:border-slate-800 dark:bg-slate-900/40">
          {data.length > 0 && (
            <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1">
              {data.map(([k, v]) => (
                <div key={k} className="contents">
                  {/* i18n-ignore: field names as recorded */}
                  <dt className="text-slate-500">{words(k)}</dt>
                  <dd className="font-mono break-words text-slate-800 dark:text-slate-200">{value(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1">
            {e.target?.href && (
              <>
                <dt className="text-slate-500">{t("Record")}</dt>
                <dd className="flex flex-wrap gap-3">
                  <Link href={e.target.href} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                    {t("Open")}
                  </Link>
                  {e.entity === "Patient" && e.entityId && (
                    <Link href={patientHref(e.entityId)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                      {t("This patient's history")}
                    </Link>
                  )}
                </dd>
              </>
            )}
            <dt className="text-slate-500">{t("Time")}</dt>
            <dd className="font-mono">{new Date(e.createdAt).toLocaleString("en-GB", { timeZone: CLINIC_TZ })}</dd>
            {e.userAgent && (
              <>
                <dt className="text-slate-500">{t("Browser")}</dt>
                <dd className="font-mono break-words text-slate-600 dark:text-slate-400">{e.userAgent}</dd>
              </>
            )}
            <dt className="text-slate-500">{t("Entry")}</dt>
            <dd className="font-mono text-slate-600 dark:text-slate-400">
              {e.id}
              {/* i18n-ignore: the action's code */}
              <span className="ml-2 text-slate-400">{e.action}</span>
            </dd>
            <dt className="text-slate-500">{t("Seal")}</dt>
            <dd className="inline-flex items-center gap-1 font-mono text-slate-600 dark:text-slate-400">
              {e.seal ? (
                <>
                  <Fingerprint aria-hidden className="size-3" />
                  {e.seal}…
                </>
              ) : (
                t("none (recorded before the log was sealed)")
              )}
            </dd>
          </dl>
        </div>
      </details>
    </li>
  );
}

function Stat({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-700 dark:text-red-400" : tone === "warn" ? "text-amber-700 dark:text-amber-300" : "text-slate-900 dark:text-white";
  const body = (
    <>
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <span className={`mt-1 block text-2xl font-semibold tabular-nums ${color}`}>{value.toLocaleString("en-US")}</span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="surface block h-full p-4 transition-colors hover:border-brand-600/40">
          {body}
        </Link>
      ) : (
        <div className="surface h-full p-4">{body}</div>
      )}
    </li>
  );
}

/** The seal: what it is, its current fingerprint, and the result of checking it. */
function Seal({ seal, integrity, verifyHref, t }: { seal: string | null; integrity: AuditIntegrity | null; verifyHref: string; t: T }) {
  const broken = integrity && !integrity.intact;
  const Icon = broken ? ShieldX : ShieldCheck;
  return (
    <section
      aria-labelledby="seal"
      className={`rounded-xl border p-4 ${
        broken ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40" : "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${broken ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`} />
        <div className="min-w-0 flex-1 text-sm">
          <h2 id="seal" className={`font-semibold ${broken ? "text-red-900 dark:text-red-200" : "text-emerald-900 dark:text-emerald-200"}`}>
            {broken ? t("The seal is broken: entries were changed or removed") : t("Tamper-evident and permanent")}
          </h2>
          <p className={broken ? "text-red-800 dark:text-red-300" : "text-emerald-900/80 dark:text-emerald-200/80"}>
            {t("Entries cannot be edited or deleted, and each is sealed to the one before it, so a change made directly in the database shows up when the seal is checked.")}
          </p>
          {seal && (
            <p className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-slate-600 dark:text-slate-400">
              <Fingerprint aria-hidden className="size-3.5" />
              {t("Latest seal {seal}", { seal })}
            </p>
          )}
          {integrity && (
            <div className={`mt-2 font-medium ${broken ? "text-red-900 dark:text-red-200" : "text-emerald-900 dark:text-emerald-200"}`}>
              {integrity.intact
                ? t("Checked {time}: all {n} sealed entries are intact.", { time: new Date(integrity.checkedAt).toLocaleTimeString("en-GB", { timeZone: CLINIC_TZ }), n: integrity.sealed.toLocaleString("en-US") })
                : t("Checked {time}: {altered} changed, {missing} with the entry before them missing.", {
                    time: new Date(integrity.checkedAt).toLocaleTimeString("en-GB", { timeZone: CLINIC_TZ }),
                    altered: integrity.altered,
                    missing: integrity.missing,
                  })}
              {integrity.unsealed > 0 && <span className="block text-xs font-normal opacity-80">{t("{n} older entries are from before the log was sealed.", { n: integrity.unsealed.toLocaleString("en-US") })}</span>}
              {integrity.alteredEntries.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs font-normal">
                  {integrity.alteredEntries.map((a) => (
                    <li key={a.id}>
                      {new Date(a.createdAt).toLocaleString("en-GB", { timeZone: CLINIC_TZ })} · {actionLabel(a.action) ? t(actionLabel(a.action)!) : a.action} · <span className="font-mono">{a.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <Link href={verifyHref} className={`${secondaryButtonClass} print:hidden`}>
          <ShieldCheck aria-hidden />
          {integrity ? t("Check again") : t("Check the seal")}
        </Link>
      </div>
    </section>
  );
}

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <>
      <PageTitle title="Audit log" subtitle="who did what, when and from where · field names and amounts only, never clinical notes" />
      <Suspense
        fallback={
          <div className="space-y-4" aria-hidden>
            <Skeleton className="h-24" />
            <Skeleton className="h-20" />
            <Skeleton className="h-96" />
          </div>
        }
      >
        <Log searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

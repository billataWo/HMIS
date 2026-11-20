import { connection } from "next/server";
import {
  AlarmClock,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CircleCheck,
  Clock,
  Download,
  FileText,
  FlaskConical,
  Minus,
  PackageX,
  Receipt,
  TriangleAlert,
  UserPlus,
  Users,
  UserX,
  type LucideIcon,
} from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { BarList, ColumnChart, Heatmap, Sparkline, TrendChart } from "@/components/charts";
import { StaggerCell, StaggerGrid } from "@/components/enter";
import { PageTitle } from "@/components/page-title";
import { PrintButton } from "@/components/print-button";
import { NoAccess } from "@/components/status-page";
import { inputClass, pillClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Dashboard, type LabTurnaround, type RightNow, type TatSummary } from "@/lib/api";
import { clinicToday, DISCOUNT_CATEGORIES, etb, formatDualDate, formatMinutes, formatTime, PAYMENT_METHODS, shiftDay } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";

type Search = { from?: string; to?: string };

function presets(today: string): [string, string, string][] {
  const monthStart = `${today.slice(0, 8)}01`;
  return [
    ["Today", today, today],
    ["Yesterday", shiftDay(today, -1), shiftDay(today, -1)],
    ["Last 7 days", shiftDay(today, -6), today],
    ["This month", monthStart, today],
    ["Last 30 days", shiftDay(today, -29), today],
    ["Last 90 days", shiftDay(today, -89), today],
  ];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const AGE_LABELS: Record<string, string> = {
  "<1": "Under 1",
  "1-4": "1–4",
  "5-14": "5–14",
  "15-29": "15–29",
  "30-64": "30–64",
  "65+": "65 and over",
  unknown: "Age not known",
};
const SOURCE_LABELS: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Lab", PHARMACY: "Pharmacy", PROCEDURE: "Procedures", OTHER: "Other" };
const WAIT_LABELS = ["Under 15 min", "15–30 min", "30–60 min", "1–2 hours", "Over 2 hours"];

/** "Thu 12 Nov" for a YYYY-MM-DD clinic day. */
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** Axis numbers: 1,500 → 1.5k. */
const compact = (v: number) => (v >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(v));

/** A change on the period before: an arrow and the percentage, green when it is good news. Not by colour alone: the arrow and words say it. */
function Delta({ now, before, good = "up", t }: { now: number; before: number; good?: "up" | "down"; t: T }) {
  const quiet = "inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  if (before === 0) return <span className={quiet}>{now === 0 ? t("no change") : t("none before")}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) {
    return (
      <span className={quiet}>
        <Minus aria-hidden className="size-3" />
        {t("no change")}
      </span>
    );
  }
  const better = good === "up" ? pct > 0 : pct < 0;
  const Icon = pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums ${
        better ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
      }`}
    >
      <Icon aria-hidden className="size-3" />
      <span className="sr-only">{pct > 0 ? t("up") : t("down")}</span>
      {Math.abs(pct)}%
    </span>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  delta,
  against,
  spark,
  note,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: ReactNode;
  against?: string;
  spark?: (number | null)[];
  note?: ReactNode;
  tone?: "warn";
}) {
  return (
    <StaggerCell className={`surface relative flex flex-col overflow-hidden p-4 ${tone === "warn" ? "ring-1 ring-amber-400/60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <span
          aria-hidden
          className={`grid size-8 place-items-center rounded-lg ${
            tone === "warn" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" : "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          }`}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
      {(delta || note) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {delta}
          {delta && against && <span>{against}</span>}
          {note}
        </div>
      )}
      {spark && <Sparkline values={spark} className="mt-3" />}
    </StaggerCell>
  );
}

function Panel({ title, children, action, id, className = "" }: { title: string; children: ReactNode; action?: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`surface min-w-0 scroll-mt-20 p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
        {title}
        <span aria-hidden className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </h2>
      {children}
    </section>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  await connection(); // "today" is the request's, not a prerender's
  const t = await getT();
  const today = clinicToday();
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  const from = valid(params.from) ?? today;
  const to = valid(params.to) ?? from;
  let d: Dashboard;
  try {
    d = await api<Dashboard>(`/reports/dashboard?from=${from}&to=${to}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only clinic admins can see reports.")}</NoAccess>;
    if (e instanceof ApiError && e.status === 400) return <p className="text-sm text-red-700 dark:text-red-400">{t(e.message)}</p>;
    throw e;
  }
  const r = d.revenue;
  const p = d.patients;
  const prev = d.previous;
  const losses = Number(d.stock.expiredLoss) + Number(d.stock.adjustmentLoss);
  const n = d.daily.length;
  const multiDay = n > 1;
  const money = (v: string | number) => etb(v, t);
  const empty = <p className="text-sm text-slate-500">{t("Nothing in this period.")}</p>;
  const against = n === 1 ? (from === today ? t("vs yesterday") : t("vs the day before")) : t("vs the previous {n} days", { n });
  const prevName = n === 1 ? t("The day before") : t("Previous {n} days", { n });
  const spark = <V,>(f: (x: Dashboard["daily"][number]) => V) => (multiDay ? d.daily.map(f) : undefined);
  const lwbs = p.cancelledByReason?.LEFT_WITHOUT_BEING_SEEN ?? 0;
  const lateResults = d.lab.turnaround ? d.lab.turnaround.withTarget - d.lab.turnaround.onTime : 0;
  const longOwed = r.ageing ? Number(r.ageing.patients[3]) + Number(r.ageing.payers[3]) : 0;

  // What an owner should look at first, worst first.
  const attention: { tone: "bad" | "warn"; icon: LucideIcon; text: string; href?: string }[] = [];
  if (d.lab.critical) attention.push({ tone: "bad", icon: FlaskConical, text: t("{n} critical lab results in this period", { n: d.lab.critical }), href: "/lab" });
  if (d.stock.expiredOnShelf) attention.push({ tone: "bad", icon: PackageX, text: t("{n} drugs have expired stock still on the shelf", { n: d.stock.expiredOnShelf }), href: "/inventory" });
  if (Number(r.unbilled) > 0)
    attention.push({ tone: "warn", icon: Receipt, text: t("{n} services delivered but not billed, worth {amount}", { n: r.unbilledCount, amount: money(r.unbilled) }), href: "/billing" });
  if (lwbs) attention.push({ tone: "warn", icon: UserX, text: t("{n} patients left without being seen", { n: lwbs }) });
  if (longOwed > 0) attention.push({ tone: "warn", icon: Banknote, text: t("{amount} has been owed for over 90 days", { amount: money(longOwed) }), href: "/billing" });
  if (lateResults > 0) attention.push({ tone: "warn", icon: AlarmClock, text: t("{n} lab results released after their target time", { n: lateResults }), href: "#lab-turnaround" });
  if (d.stock.low) attention.push({ tone: "warn", icon: PackageX, text: t("{n} drugs are low on stock", { n: d.stock.low }), href: "/inventory" });

  // When patients arrive: a weekday × hour grid over a week or more, check-ins by hour otherwise.
  const arrivals = p.arrivals;
  const byHour = arrivals ? Array.from({ length: 24 }, (_, h) => arrivals.reduce((s, row) => s + row[h], 0)) : [];
  const busyHours = byHour.flatMap((v, h) => (v ? [h] : []));
  const firstHour = Math.min(7, ...busyHours);
  const lastHour = Math.max(18, ...busyHours);
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const busiest = { day: 0, hour: 0, n: 0 };
  for (const [day, row] of (arrivals ?? []).entries()) {
    for (const [hour, v] of row.entries()) if (v > busiest.n) Object.assign(busiest, { day, hour, n: v });
  }
  const peakHour = byHour.indexOf(Math.max(0, ...byHour));

  const checkedIn = p.visits + (p.cancelled ?? 0);
  const sexAge = (p.bySexAge ?? []).filter((x) => x.ageGroup !== "unknown" || x.male + x.female > 0);
  const maxAge = Math.max(1, ...sexAge.map((x) => x.male + x.female));
  const methods = Object.entries(r.byMethod).filter(([, v]) => Number(v) !== 0);
  const sources = (r.bySource ?? []).filter((x) => Number(x.amount) > 0);

  return (
    <div className="space-y-8">
      {d.now && <AutoRefresh seconds={60} />}

      {/* The period: quick choices, any range, and the file versions. */}
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label={t("Period")} className="flex flex-wrap gap-1.5">
            {presets(today).map(([label, f, until]) => (
              <Link
                key={label}
                href={`/dashboard?from=${f}&to=${until}`}
                aria-current={from === f && to === until ? "page" : undefined}
                className={pillClass(from === f && to === until)}
              >
                {t(label)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a href={`/dashboard/csv?from=${from}&to=${to}`} download className={secondaryButtonClass}>
              <Download aria-hidden />
              {t("Download CSV")}
            </a>
            <PrintButton inline />
          </div>
        </div>
        <Form action="/dashboard" className="flex flex-wrap items-center gap-2 text-sm">
          <input type="date" name="from" defaultValue={from} max={today} aria-label={t("From")} className={`${inputClass} w-40`} />
          <span className="text-slate-500">{t("to")}</span>
          <input type="date" name="to" defaultValue={to} max={today} aria-label={t("To")} className={`${inputClass} w-40`} />
          <button className={secondaryButtonClass}>{t("Show")}</button>
        </Form>
      </div>
      <p className="-mt-4 text-sm text-slate-500">
        <span className="font-medium text-slate-700 dark:text-slate-300">
          {from === to ? formatDualDate(`${from}T12:00:00+03:00`) : `${formatDualDate(`${from}T12:00:00+03:00`)} – ${formatDualDate(`${to}T12:00:00+03:00`)}`}
        </span>
        {prev && (
          <>
            {" · "}
            {t("compared with {period}", { period: prev.from === prev.to ? shortDate(prev.from) : `${shortDate(prev.from)} – ${shortDate(prev.to)}` })}
          </>
        )}
      </p>

      {d.now && <Now now={d.now} t={t} />}

      <StaggerGrid className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label={t("Patient visits")}
          value={p.visits.toLocaleString("en-US")}
          icon={Users}
          delta={prev && <Delta now={p.visits} before={prev.visits} t={t} />}
          against={against}
          note={<span>{t("{n} completed", { n: p.completed })}</span>}
          spark={spark((x) => x.visits)}
        />
        <Kpi
          label={t("New patients registered")}
          value={p.newPatients.toLocaleString("en-US")}
          icon={UserPlus}
          delta={prev && <Delta now={p.newPatients} before={prev.newPatients} t={t} />}
          against={against}
          spark={spark((x) => x.newPatients ?? 0)}
        />
        <Kpi
          label={t("Average wait to see a doctor")}
          value={p.avgWaitMinutes === null ? "—" : t("{n} min", { n: p.avgWaitMinutes })}
          icon={Clock}
          delta={prev && p.avgWaitMinutes !== null && prev.avgWaitMinutes !== null && <Delta now={p.avgWaitMinutes} before={prev.avgWaitMinutes} good="down" t={t} />}
          against={prev && p.avgWaitMinutes !== null && prev.avgWaitMinutes !== null ? against : undefined}
          note={p.p90WaitMinutes != null && <span>{t("9 in 10 seen within {time}", { time: formatMinutes(p.p90WaitMinutes, t) })}</span>}
          spark={spark((x) => x.avgWaitMinutes ?? null)}
        />
        <Kpi
          label={t("Cash collected")}
          value={money(r.collected)}
          icon={Banknote}
          delta={prev && <Delta now={Number(r.collected)} before={Number(prev.collected)} t={t} />}
          against={against}
          spark={spark((x) => Number(x.collected))}
        />
        <Kpi
          label={t("Billed")}
          value={money(r.billed)}
          icon={Receipt}
          delta={prev && <Delta now={Number(r.billed)} before={Number(prev.billed)} t={t} />}
          against={against}
          note={Number(r.discounts) > 0 && <span>{t("discounts {amount}", { amount: money(r.discounts) })}</span>}
          spark={spark((x) => Number(x.billed ?? 0))}
        />
        <Kpi
          label={t("Delivered but not billed")}
          value={money(r.unbilled)}
          icon={TriangleAlert}
          tone={Number(r.unbilled) > 0 ? "warn" : undefined}
          note={<span>{t("{n} charges with no invoice", { n: r.unbilledCount })}</span>}
        />
      </StaggerGrid>

      <Attention items={attention} t={t} />

      <Section title={t("Patients")}>
        {multiDay && (
          <div className="surface p-5">
            <TrendChart
              t={t}
              title={t("Visits per day")}
              whole
              tick={(l) => l.slice(4)}
              points={d.daily.map((x) => ({ label: dayLabel(x.day), value: x.visits, display: t("{n} visits", { n: x.visits }) }))}
              previous={prev?.daily?.visits.map((v) => ({ value: v, display: String(v) }))}
              previousLabel={prevName}
            />
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title={t("When patients arrive")}
            action={
              peakHour >= 0 && byHour[peakHour] > 0 ? (
                <span className="text-xs text-slate-500">
                  {n >= 7 && busiest.n
                    ? t("busiest: {day} {hour}", { day: t(WEEKDAYS[busiest.day]), hour: hh(busiest.hour) })
                    : t("busiest hour: {hour}", { hour: hh(peakHour) })}
                </span>
              ) : undefined
            }
          >
            {!arrivals || p.visits === 0 ? (
              empty
            ) : n >= 7 ? (
              <Heatmap
                t={t}
                label={t("Check-ins by weekday and hour")}
                rows={WEEKDAYS.map((w) => t(w))}
                cols={hours.map((h) => String(h).padStart(2, "0"))}
                values={arrivals.map((row) => hours.map((h) => row[h]))}
                cell={(r, c, v) => t("{day} {hour}: {n} check-ins", { day: t(WEEKDAYS[r]), hour: hh(hours[c]), n: v })}
              />
            ) : (
              <ColumnChart
                t={t}
                title={t("Check-ins by hour")}
                tick={(l) => l}
                ariaLabel={t("Check-ins by hour")}
                points={hours.map((h) => ({ label: hh(h), value: byHour[h], display: String(byHour[h]) }))}
              />
            )}
          </Panel>

          <Panel title={t("Patient flow")} action={<span className="text-xs text-slate-500">{t("{n} checked in", { n: checkedIn })}</span>}>
            {checkedIn === 0 ? (
              empty
            ) : (
              <>
                <Flow
                  rows={[
                    { label: t("Checked in"), value: checkedIn },
                    { label: t("Seen by a doctor"), value: p.seen ?? p.visits },
                    { label: t("Completed"), value: p.completed },
                    { label: t("Cancelled"), value: p.cancelled ?? 0, note: lwbs ? t("{n} left without being seen", { n: lwbs }) : undefined, tone: "warn" },
                  ]}
                  of={checkedIn}
                />
                {p.waitBands && (p.seen ?? 0) > 0 && (
                  <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <h4 className="font-medium">{t("Wait to see a doctor")}</h4>
                      <span className="text-xs text-slate-500">
                        {t("median {time}", { time: p.medianWaitMinutes == null ? "—" : formatMinutes(p.medianWaitMinutes, t) })}
                      </span>
                    </div>
                    <BarList share items={p.waitBands.map((v, i) => ({ key: WAIT_LABELS[i], label: t(WAIT_LABELS[i]), value: v, display: String(v) }))} />
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel title={t("Who came")} action={<span className="text-xs text-slate-500">{t("visits by age and sex")}</span>}>
            {p.visits === 0 || sexAge.length === 0 ? (
              empty
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 font-medium">{t("Age")}</th>
                    <th className="py-1 text-right font-medium">{t("Male")}</th>
                    <th className="py-1 text-right font-medium">{t("Female")}</th>
                    <th className="w-2/5 py-1 pl-4 font-medium">{t("Total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sexAge.map((x) => (
                    <tr key={x.ageGroup} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5">{t(AGE_LABELS[x.ageGroup] ?? x.ageGroup)}</td>
                      <td className="py-1.5 text-right tabular-nums">{x.male}</td>
                      <td className="py-1.5 text-right tabular-nums">{x.female}</td>
                      <td className="py-1.5 pl-4">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                            <span className="block h-full rounded-full bg-brand-700 dark:bg-brand-500" style={{ width: `${((x.male + x.female) / maxAge) * 100}%` }} />
                          </span>
                          <span className="w-8 text-right tabular-nums">{x.male + x.female}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title={t("Patients seen by doctor")}>
            {p.byDoctor.length ? (
              <BarList share items={p.byDoctor.map((x) => ({ key: x.name, label: t("Dr. {name}", { name: x.name }), value: x.count, display: String(x.count) }))} />
            ) : (
              empty
            )}
          </Panel>
        </div>
      </Section>

      <Section title={t("Money")}>
        {multiDay && (
          <div className="surface p-5">
            <TrendChart
              t={t}
              title={t("Cash collected per day")}
              unit={t("ETB")}
              axis={compact}
              tick={(l) => l.slice(4)}
              points={d.daily.map((x) => ({ label: dayLabel(x.day), value: Number(x.collected), display: Number(x.collected).toLocaleString("en-US", { minimumFractionDigits: 2 }) }))}
              previous={prev?.daily?.collected.map((v) => ({ value: Number(v), display: money(v) }))}
              previousLabel={prevName}
            />
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t("Payments by method")} action={<span className="text-xs text-slate-500">{money(r.collected)}</span>}>
            {methods.length ? (
              <BarList share items={methods.map(([m, v]) => ({ key: m, label: t(PAYMENT_METHODS[m] ?? m), value: Number(v), display: money(v!) }))} />
            ) : (
              <p className="text-sm text-slate-500">{t("No payments in this period.")}</p>
            )}
          </Panel>

          <Panel title={t("Services delivered, by department")} action={<span className="text-xs text-slate-500">{t("billed or not")}</span>}>
            {sources.length ? (
              <BarList share items={sources.map((x) => ({ key: x.source, label: t(SOURCE_LABELS[x.source] ?? x.source), value: Number(x.amount), display: money(x.amount) }))} />
            ) : (
              empty
            )}
          </Panel>

          <Panel title={t("Money owed")} className="lg:col-span-2">
            <div className="grid gap-6 lg:grid-cols-2">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between font-medium">
                  <dt>{t("Patients still owe (all time)")}</dt>
                  <dd className="tabular-nums">{money(r.patientsOwe)}</dd>
                </div>
                {r.receivables.map((x) => (
                  <div key={x.payer} className="flex justify-between text-slate-600 dark:text-slate-400">
                    <dt>{x.payer}</dt>
                    <dd className="tabular-nums">{money(x.due)}</dd>
                  </div>
                ))}
                {r.discountsBy && r.discountsBy.length > 0 && (
                  <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                    <h4 className="mb-1 text-sm font-medium">{t("Discounts and exemptions in this period")}</h4>
                    {r.discountsBy.map((x) => (
                      <div key={x.category} className="flex justify-between gap-3">
                        <dt className="text-slate-600 dark:text-slate-400">
                          {t(DISCOUNT_CATEGORIES[x.category] ?? x.category)} <span className="text-xs">({x.count})</span>
                        </dt>
                        <dd className="tabular-nums">{money(x.amount)}</dd>
                      </div>
                    ))}
                  </div>
                )}
              </dl>
              {r.ageing && <Ageing ageing={r.ageing} t={t} />}
            </div>
          </Panel>
        </div>
      </Section>

      <Section title={t("Clinical")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t("Top diagnoses")}>
            {d.topDiagnoses.length ? (
              <BarList
                items={d.topDiagnoses.map((x) => ({
                  key: x.code,
                  label: (
                    <>
                      <span className="font-mono text-xs text-slate-500">{x.code}</span> {x.label}
                    </>
                  ),
                  value: x.count,
                  display: String(x.count),
                }))}
              />
            ) : (
              empty
            )}
          </Panel>

          <Panel
            title={t("Lab")}
            action={
              <span className="text-xs text-slate-500">
                {t("{n} abnormal results", { n: d.lab.abnormal })}
                {d.lab.critical ? <span className="font-medium text-red-700 dark:text-red-400"> · {t("{n} critical", { n: d.lab.critical })}</span> : null}
              </span>
            }
          >
            <p className="mb-3 text-sm">
              {t("{ordered} tests ordered · {verified} verified", { ordered: d.lab.ordered, verified: d.lab.verified })}
              {d.lab.urgent ? ` · ${t("{n} urgent", { n: d.lab.urgent })}` : ""}
            </p>
            {d.lab.topTests.length ? <BarList items={d.lab.topTests.map((x) => ({ key: x.name, label: x.name, value: x.count, display: String(x.count) }))} /> : empty}
          </Panel>

          {d.lab.turnaround && <Turnaround tat={d.lab.turnaround} t={t} />}
        </div>
      </Section>

      <Section title={t("Pharmacy and stock")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t("Pharmacy")} action={<span className="text-xs text-slate-500">{t("sales {amount}", { amount: money(d.pharmacy.sales) })}</span>}>
            <p className="mb-3 text-sm">{t("{n} units dispensed", { n: d.pharmacy.unitsDispensed })}</p>
            {d.pharmacy.topDrugs.length ? <BarList items={d.pharmacy.topDrugs.map((x) => ({ key: x.name, label: x.name, value: x.units, display: String(x.units) }))} /> : empty}
          </Panel>

          <Panel title={t("Stock")} action={<Link href="/inventory" className="text-xs text-brand-700 hover:underline dark:text-brand-400">{t("Inventory")}</Link>}>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt>{t("Value on shelf (cost)")}</dt>
              <dd className="text-right tabular-nums">{money(d.stock.value)}</dd>
              <dt>{t("Low-stock drugs")}</dt>
              <dd className={`text-right tabular-nums ${d.stock.low ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{d.stock.low}</dd>
              <dt>{t("Expiring within 90 days")}</dt>
              <dd className="text-right tabular-nums">{d.stock.expiring}</dd>
              <dt>{t("Expired still on shelf")}</dt>
              <dd className={`text-right tabular-nums ${d.stock.expiredOnShelf ? "font-medium text-red-700 dark:text-red-400" : ""}`}>{d.stock.expiredOnShelf}</dd>
              <dt>{t("Lost in this period")}</dt>
              <dd className={`text-right tabular-nums ${losses ? "font-medium text-red-700 dark:text-red-400" : ""}`}>{money(losses)}</dd>
            </dl>
            {losses > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {t("Expired {expired} · damaged, lost or corrected {other}", { expired: money(d.stock.expiredLoss), other: money(d.stock.adjustmentLoss) })}
              </p>
            )}
          </Panel>
        </div>
      </Section>

      {multiDay && (
        <details className="surface p-5 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300">{t("Show the daily numbers as a table")}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-xl text-left">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 font-medium">{t("Day")}</th>
                  <th className="py-1 text-right font-medium">{t("Visits")}</th>
                  <th className="py-1 text-right font-medium">{t("New patients")}</th>
                  <th className="py-1 text-right font-medium">{t("Average wait")}</th>
                  <th className="py-1 text-right font-medium">{t("Billed")}</th>
                  <th className="py-1 text-right font-medium">{t("Collected")}</th>
                </tr>
              </thead>
              <tbody>
                {d.daily.map((x) => (
                  <tr key={x.day} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1">{dayLabel(x.day)}</td>
                    <td className="py-1 text-right tabular-nums">{x.visits}</td>
                    <td className="py-1 text-right tabular-nums">{x.newPatients ?? "—"}</td>
                    <td className="py-1 text-right tabular-nums">{x.avgWaitMinutes == null ? "—" : formatMinutes(x.avgWaitMinutes, t)}</td>
                    <td className="py-1 text-right tabular-nums">{x.billed === undefined ? "—" : money(x.billed)}</td>
                    <td className="py-1 text-right tabular-nums">{money(x.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/** Right now in the clinic: who is where, and the work waiting in each department. Refreshes every minute. */
function Now({ now, t }: { now: RightNow; t: T }) {
  const items: { label: string; value: number; href: string; note?: string; warn?: boolean }[] = [
    {
      label: t("Waiting for the doctor"),
      value: now.waiting,
      href: "/queue",
      note: now.longestWaitMinutes !== null ? t("longest {time}", { time: formatMinutes(now.longestWaitMinutes, t) }) : undefined,
      warn: (now.longestWaitMinutes ?? 0) >= 60,
    },
    { label: t("With the doctor"), value: now.inConsultation, href: "/queue" },
    { label: t("Waiting for lab results"), value: now.awaitingLab, href: "/lab" },
    { label: t("Waiting at the pharmacy"), value: now.awaitingPharmacy, href: "/pharmacy" },
    { label: t("Samples to take"), value: now.samplesToTake, href: "/lab" },
    { label: t("Results to check"), value: now.resultsToVerify, href: "/lab" },
    { label: t("Prescriptions to dispense"), value: now.prescriptionsToDispense, href: "/pharmacy" },
    { label: t("Visits with charges not billed"), value: now.visitsToBill, href: "/billing" },
  ];
  return (
    <section aria-labelledby="right-now" className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 id="right-now" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          {t("Right now")}
        </h2>
        <span className="text-xs text-slate-500">{t("updated {time} · refreshes every minute", { time: formatTime(now.at) })}</span>
      </div>
      <ul className="grid grid-cols-2 divide-slate-200 sm:grid-cols-4 xl:grid-cols-8 dark:divide-slate-800 [&>li]:border-slate-200 dark:[&>li]:border-slate-800">
        {items.map((x, i) => (
          <li key={x.label} className={`border-b sm:border-b-0 ${i % 2 ? "" : "border-r"} sm:border-r xl:last:border-r-0 ${i < 4 ? "sm:border-b xl:border-b-0" : ""}`}>
            <Link href={x.href} className="block h-full px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 dark:hover:bg-slate-800/60">
              <span className={`block text-2xl font-semibold tabular-nums ${x.value ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-600"}`}>{x.value}</span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-600 dark:text-slate-400">{x.label}</span>
              {x.note && (
                <span className={`mt-0.5 block text-xs font-medium ${x.warn ? "text-amber-700 dark:text-amber-400" : "text-slate-500"}`}>
                  {x.warn && <AlarmClock aria-hidden className="mr-1 inline size-3 align-[-2px]" />}
                  {x.note}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What needs looking at in this period, worst first; a calm line when nothing does. */
function Attention({ items, t }: { items: { tone: "bad" | "warn"; icon: LucideIcon; text: string; href?: string }[]; t: T }) {
  if (!items.length) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {t("Nothing needs attention in this period.")}
      </p>
    );
  }
  return (
    <section aria-labelledby="attention" className="surface p-5">
      <h2 id="attention" className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <TriangleAlert aria-hidden className="size-4 text-amber-600 dark:text-amber-400" />
        {t("Needs attention")}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-300">{items.length}</span>
      </h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {items.map((x) => {
          const body = (
            <>
              <span
                aria-hidden
                className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                  x.tone === "bad" ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                }`}
              >
                <x.icon className="size-4" />
              </span>
              <span className="flex-1">{x.text}</span>
              {x.href && <ArrowUpRight aria-hidden className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />}
            </>
          );
          return (
            <li key={x.text}>
              {x.href ? (
                <Link
                  href={x.href}
                  className="group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Each step of the visit as a share of everyone who checked in. */
function Flow({ rows, of }: { rows: { label: string; value: number; note?: string; tone?: "warn" }[]; of: number }) {
  return (
    <ul className="space-y-3 text-sm">
      {rows.map((x) => (
        <li key={x.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
          <span>
            {x.label}
            {x.note && <span className="ml-2 text-xs font-medium text-amber-700 dark:text-amber-400">{x.note}</span>}
          </span>
          <span className="text-right tabular-nums text-slate-600 dark:text-slate-400">
            {x.value}
            <span className="ml-2 inline-block w-10 text-xs text-slate-500">{of ? Math.round((x.value / of) * 100) : 0}%</span>
          </span>
          <span className="col-span-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
            <span
              className={`block h-full origin-left animate-grow-x rounded-full ${x.tone === "warn" ? "bg-slate-400 dark:bg-slate-500" : "bg-brand-700 dark:bg-brand-500"}`}
              style={{ width: of ? `${(x.value / of) * 100}%` : 0 }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "18 of 20 on target (90%)", amber below 80%. */
function OnTarget({ s, t }: { s: TatSummary; t: T }) {
  if (!s.withTarget) return <span className="text-slate-500">{t("no targets set")}</span>;
  const pct = Math.round((s.onTime / s.withTarget) * 100);
  return <span className={pct < 80 ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{t("{n} of {total} ({pct}%)", { n: s.onTime, total: s.withTarget, pct })}</span>;
}

/** How fast the lab releases results: sample to release (the lab's time), against each test's target. */
function Turnaround({ tat, t }: { tat: LabTurnaround; t: T }) {
  const mins = (m: number | null) => (m === null ? "—" : formatMinutes(m, t));
  return (
    <Panel id="lab-turnaround" className="lg:col-span-2" title={t("Lab turnaround")} action={<span className="text-xs text-slate-500">{t("sample taken → result released")}</span>}>
      {tat.count === 0 ? (
        <p className="text-sm text-slate-500">{t("No released results in this period.")}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <dl className="grid grid-cols-2 content-start gap-y-1 text-sm">
            <dt>{t("Median time")}</dt>
            <dd className="text-right tabular-nums">{mins(tat.medianMinutes)}</dd>
            <dt>{t("On target")}</dt>
            <dd className="text-right tabular-nums">
              <OnTarget s={tat} t={t} />
            </dd>
            <dt>{t("Urgent tests")}</dt>
            <dd className="text-right tabular-nums">
              {tat.urgent.count ? (
                <>
                  {tat.urgent.count} · {t("median {time}", { time: mins(tat.urgent.medianMinutes) })} · <OnTarget s={tat.urgent} t={t} />
                </>
              ) : (
                t("none")
              )}
            </dd>
            <dt className="text-slate-500">{t("Order → result (with paying)")}</dt>
            <dd className="text-right text-slate-500 tabular-nums">{mins(tat.orderToReleaseMinutes)}</dd>
          </dl>
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 font-medium">{t("Test")}</th>
                    <th className="py-1 text-right font-medium">{t("Released")}</th>
                    <th className="py-1 text-right font-medium">{t("Median")}</th>
                    <th className="py-1 text-right font-medium">{t("Target")}</th>
                    <th className="py-1 text-right font-medium">{t("Late")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tat.tests.map((x) => (
                    <tr key={x.name} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1">{x.name}</td>
                      <td className="py-1 text-right tabular-nums">{x.count}</td>
                      <td className="py-1 text-right tabular-nums">{mins(x.medianMinutes)}</td>
                      <td className="py-1 text-right text-slate-500 tabular-nums">{mins(x.targetMinutes)}</td>
                      <td className={`py-1 text-right tabular-nums ${x.withTarget - x.onTime ? "font-medium text-red-700 dark:text-red-400" : "text-slate-500"}`}>
                        {x.withTarget ? x.withTarget - x.onTime : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t("Targets are set per test in Settings → Prices; urgent tests use the clinic's urgent target. Amended results are left out.")}
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** How old the money owed is: by patients and by credit companies and insurers. */
function Ageing({ ageing, t }: { ageing: { patients: string[]; payers: string[] }; t: T }) {
  const heads = ["0–30 days", "31–60", "61–90", "Over 90"];
  const row = (label: string, xs: string[]) => (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="py-1 pr-2">{label}</td>
      {xs.map((x, i) => (
        <td key={i} className={`py-1 pl-2 text-right tabular-nums ${i >= 2 && Number(x) > 0 ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
          {Number(x) > 0 ? etb(x, t) : "—"}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <h4 className="mb-1 text-sm font-medium">{t("Owed, by age")}</h4>
      <table className="w-full min-w-88 text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-2 text-left font-medium" />
            {heads.map((h) => (
              <th key={h} className="py-1 pl-2 text-right font-medium">
                {t(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row(t("Patients"), ageing.patients)}
          {row(t("Credit and insurance"), ageing.payers)}
        </tbody>
      </table>
    </div>
  );
}

async function ReportLinks() {
  const t = await getT();
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Link href="/reports" className={secondaryButtonClass}>
        <FileText aria-hidden />
        {t("All reports")}
      </Link>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <>
      <PageTitle title="Dashboard" subtitle="how the clinic is doing" actions={<ReportLinks />} />
      <Suspense fallback={<Loading />}>
        <Report searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

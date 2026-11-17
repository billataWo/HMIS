import { connection } from "next/server";
import { FileText } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { BarList, ColumnChart } from "@/components/charts";
import { StaggerCell, StaggerGrid } from "@/components/enter";
import { PageTitle } from "@/components/page-title";
import { inputClass, pillClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Dashboard, type LabTurnaround, type TatSummary } from "@/lib/api";
import { clinicToday, DISCOUNT_CATEGORIES, etb, formatDualDate, formatMinutes, PAYMENT_METHODS, shiftDay } from "@/lib/format";
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
  ];
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warn" | "bad" }) {
  const color =
    tone === "bad" ? "text-red-700 dark:text-red-400" : tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-white";
  return (
    <StaggerCell className="surface relative overflow-hidden p-4">
      {tone && <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tone === "bad" ? "bg-red-500" : "bg-amber-500"}`} />}
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </StaggerCell>
  );
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="surface p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
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
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only clinic admins can see reports.")}</p>;
    if (e instanceof ApiError && e.status === 400) return <p className="text-sm text-red-700">{t(e.message)}</p>;
    throw e;
  }
  const r = d.revenue;
  const losses = Number(d.stock.expiredLoss) + Number(d.stock.adjustmentLoss);
  const multiDay = d.daily.length > 1;
  const money = (v: string | number) => etb(v, t);
  const empty = <p className="text-sm text-slate-500">{t("Nothing in this period.")}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {presets(today).map(([label, f, until]) => (
          <Link
            key={label}
            href={`/reports?from=${f}&to=${until}`}
            aria-current={from === f && to === until ? "page" : undefined}
            className={pillClass(from === f && to === until)}
          >
            {t(label)}
          </Link>
        ))}
        <Form action="/reports" className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <input type="date" name="from" defaultValue={from} max={today} aria-label={t("From")} className={`${inputClass} w-40`} />
          <span className="text-slate-500">{t("to")}</span>
          <input type="date" name="to" defaultValue={to} max={today} aria-label={t("To")} className={`${inputClass} w-40`} />
          <button className={secondaryButtonClass}>{t("Show")}</button>
        </Form>
      </div>
      <p className="text-sm text-slate-500">
        {from === to ? formatDualDate(`${from}T12:00:00+03:00`) : `${formatDualDate(`${from}T12:00:00+03:00`)} – ${formatDualDate(`${to}T12:00:00+03:00`)}`}
      </p>

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("Patient visits")} value={String(d.patients.visits)} note={t("{n} new patients registered", { n: d.patients.newPatients })} />
        <Tile
          label={t("Average wait to see a doctor")}
          value={d.patients.avgWaitMinutes === null ? "—" : t("{n} min", { n: d.patients.avgWaitMinutes })}
          note={
            d.patients.cancelled
              ? t("{n} cancelled · {left} left without being seen", { n: d.patients.cancelled, left: d.patients.cancelledByReason?.LEFT_WITHOUT_BEING_SEEN ?? 0 })
              : undefined
          }
        />
        <Tile label={t("Cash collected")} value={money(r.collected)} note={t("Billed {billed} · discounts {discounts}", { billed: money(r.billed), discounts: money(r.discounts) })} />
        <Tile
          label={t("Delivered but not billed")}
          value={money(r.unbilled)}
          note={t("{n} charges with no invoice", { n: r.unbilledCount })}
          tone={Number(r.unbilled) > 0 ? "warn" : undefined}
        />
      </StaggerGrid>

      {multiDay && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t("Visits per day")}>
            <ColumnChart t={t} title={t("Visits")} points={d.daily.map((x) => ({ label: x.day, value: x.visits, display: String(x.visits) }))} />
          </Panel>
          <Panel title={t("Cash collected per day")}>
            <ColumnChart t={t} title={t("Collected")} unit={t("ETB")} points={d.daily.map((x) => ({ label: x.day, value: Number(x.collected), display: Number(x.collected).toFixed(2) }))} />
          </Panel>
          <details className="text-sm lg:col-span-2">
            <summary className="cursor-pointer text-slate-500">{t("Show the daily numbers as a table")}</summary>
            <table className="mt-2 w-full max-w-md text-left">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 font-medium">{t("Day")}</th>
                  <th className="py-1 text-right font-medium">{t("Visits")}</th>
                  <th className="py-1 text-right font-medium">{t("Collected")}</th>
                </tr>
              </thead>
              <tbody>
                {d.daily.map((x) => (
                  <tr key={x.day} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1">{x.day}</td>
                    <td className="py-1 text-right tabular-nums">{x.visits}</td>
                    <td className="py-1 text-right tabular-nums">{money(x.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("Top diagnoses")}>
          {d.topDiagnoses.length
            ? <BarList items={d.topDiagnoses.map((x) => ({ key: x.code, label: <><span className="font-mono text-xs text-slate-500">{x.code}</span> {x.label}</>, value: x.count, display: String(x.count) }))} />
            : empty}
        </Panel>

        <Panel title={t("Money")}>
          <dl className="space-y-1 text-sm">
            {Object.entries(r.byMethod).map(([m, v]) => (
              <div key={m} className="flex justify-between">
                <dt>{t(PAYMENT_METHODS[m] ?? m)}</dt>
                <dd className="tabular-nums">{money(v!)}</dd>
              </div>
            ))}
            {Object.keys(r.byMethod).length === 0 && <p className="text-slate-500">{t("No payments in this period.")}</p>}
            <div className="flex justify-between border-t border-slate-200 pt-2 font-medium dark:border-slate-700">
              <dt>{t("Patients still owe (all time)")}</dt>
              <dd className="tabular-nums">{money(r.patientsOwe)}</dd>
            </div>
            {r.receivables.map((x) => (
              <div key={x.payer} className="flex justify-between text-slate-600 dark:text-slate-400">
                <dt>{x.payer}</dt>
                <dd className="tabular-nums">{money(x.due)}</dd>
              </div>
            ))}
          </dl>
          {r.ageing && <Ageing ageing={r.ageing} t={t} />}
          {r.discountsBy && r.discountsBy.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
              <h3 className="mb-1 text-sm font-medium">{t("Discounts and exemptions in this period")}</h3>
              <dl className="space-y-1 text-sm">
                {r.discountsBy.map((x) => (
                  <div key={x.category} className="flex justify-between gap-3">
                    <dt className="text-slate-600 dark:text-slate-400">
                      {t(DISCOUNT_CATEGORIES[x.category] ?? x.category)} <span className="text-xs">({x.count})</span>
                    </dt>
                    <dd className="tabular-nums">{money(x.amount)}</dd>
                  </div>
                ))}
              </dl>
            </div>
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

        <Panel title={t("Patients seen by doctor")}>
          {d.patients.byDoctor.length
            ? <BarList items={d.patients.byDoctor.map((x) => ({ key: x.name, label: t("Dr. {name}", { name: x.name }), value: x.count, display: String(x.count) }))} />
            : empty}
        </Panel>
      </div>
    </div>
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
    <Panel title={t("Lab turnaround")} action={<span className="text-xs text-slate-500">{t("sample taken → result released")}</span>}>
      {tat.count === 0 ? (
        <p className="text-sm text-slate-500">{t("No released results in this period.")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
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
          <div className="mt-3 overflow-x-auto">
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
        </>
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
    <div className="mt-4 overflow-x-auto border-t border-slate-200 pt-3 dark:border-slate-700">
      <h3 className="mb-1 text-sm font-medium">{t("Owed, by age")}</h3>
      <table className="w-full min-w-[22rem] text-sm">
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
    <div className="flex flex-wrap gap-2">
      <Link href="/reports/idsr" className={secondaryButtonClass}>
        <FileText aria-hidden />
        {t("Weekly IDSR report")}
      </Link>
      <Link href="/reports/moh" className={secondaryButtonClass}>
        <FileText aria-hidden />
        {t("Monthly MoH report")}
      </Link>
    </div>
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <>
      <PageTitle title="Reports" subtitle="how the clinic is doing" actions={<ReportLinks />} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Report searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

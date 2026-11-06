import { FileText } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { BarList, ColumnChart } from "@/components/charts";
import { StaggerCell, StaggerGrid } from "@/components/enter";
import { inputClass, PageHeader, pillClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type Dashboard } from "@/lib/api";
import { clinicToday, etb, formatDualDate, PAYMENT_METHODS, shiftDay } from "@/lib/format";

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

const empty = <p className="text-sm text-slate-500">Nothing in this period.</p>;

async function Report({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const today = clinicToday();
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  const from = valid(params.from) ?? today;
  const to = valid(params.to) ?? from;
  let d: Dashboard;
  try {
    d = await api<Dashboard>(`/reports/dashboard?from=${from}&to=${to}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only clinic admins can see reports.</p>;
    if (e instanceof ApiError && e.status === 400) return <p className="text-sm text-red-700">{e.message}</p>;
    throw e;
  }
  const r = d.revenue;
  const losses = Number(d.stock.expiredLoss) + Number(d.stock.adjustmentLoss);
  const multiDay = d.daily.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {presets(today).map(([label, f, t]) => (
          <Link
            key={label}
            href={`/reports?from=${f}&to=${t}`}
            aria-current={from === f && to === t ? "page" : undefined}
            className={pillClass(from === f && to === t)}
          >
            {label}
          </Link>
        ))}
        <Form action="/reports" className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <input type="date" name="from" defaultValue={from} max={today} aria-label="From" className={`${inputClass} w-40`} />
          <span className="text-slate-500">to</span>
          <input type="date" name="to" defaultValue={to} max={today} aria-label="To" className={`${inputClass} w-40`} />
          <button className={secondaryButtonClass}>Show</button>
        </Form>
      </div>
      <p className="text-sm text-slate-500">
        {from === to ? formatDualDate(`${from}T12:00:00+03:00`) : `${formatDualDate(`${from}T12:00:00+03:00`)} – ${formatDualDate(`${to}T12:00:00+03:00`)}`}
      </p>

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Patient visits" value={String(d.patients.visits)} note={`${d.patients.newPatients} new patients registered`} />
        <Tile label="Average wait to see a doctor" value={d.patients.avgWaitMinutes === null ? "—" : `${d.patients.avgWaitMinutes} min`} />
        <Tile label="Cash collected" value={etb(r.collected)} note={`Billed ${etb(r.billed)} · discounts ${etb(r.discounts)}`} />
        <Tile
          label="Delivered but not billed"
          value={etb(r.unbilled)}
          note={`${r.unbilledCount} charges with no invoice`}
          tone={Number(r.unbilled) > 0 ? "warn" : undefined}
        />
      </StaggerGrid>

      {multiDay && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Visits per day">
            <ColumnChart title="Visits" points={d.daily.map((x) => ({ label: x.day, value: x.visits, display: String(x.visits) }))} />
          </Panel>
          <Panel title="Cash collected per day">
            <ColumnChart title="Collected" unit="ETB" points={d.daily.map((x) => ({ label: x.day, value: Number(x.collected), display: Number(x.collected).toFixed(2) }))} />
          </Panel>
          <details className="text-sm lg:col-span-2">
            <summary className="cursor-pointer text-slate-500">Show the daily numbers as a table</summary>
            <table className="mt-2 w-full max-w-md text-left">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 font-medium">Day</th>
                  <th className="py-1 text-right font-medium">Visits</th>
                  <th className="py-1 text-right font-medium">Collected</th>
                </tr>
              </thead>
              <tbody>
                {d.daily.map((x) => (
                  <tr key={x.day} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1">{x.day}</td>
                    <td className="py-1 text-right tabular-nums">{x.visits}</td>
                    <td className="py-1 text-right tabular-nums">{etb(x.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Top diagnoses">
          {d.topDiagnoses.length
            ? <BarList items={d.topDiagnoses.map((x) => ({ key: x.code, label: <><span className="font-mono text-xs text-slate-500">{x.code}</span> {x.label}</>, value: x.count, display: String(x.count) }))} />
            : empty}
        </Panel>

        <Panel title="Money">
          <dl className="space-y-1 text-sm">
            {Object.entries(r.byMethod).map(([m, v]) => (
              <div key={m} className="flex justify-between">
                <dt>{PAYMENT_METHODS[m]}</dt>
                <dd className="tabular-nums">{etb(v!)}</dd>
              </div>
            ))}
            {Object.keys(r.byMethod).length === 0 && <p className="text-slate-500">No payments in this period.</p>}
            <div className="flex justify-between border-t border-slate-200 pt-2 font-medium dark:border-slate-700">
              <dt>Patients still owe (all time)</dt>
              <dd className="tabular-nums">{etb(r.patientsOwe)}</dd>
            </div>
            {r.receivables.map((x) => (
              <div key={x.payer} className="flex justify-between text-slate-600 dark:text-slate-400">
                <dt>{x.payer}</dt>
                <dd className="tabular-nums">{etb(x.due)}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Lab" action={<span className="text-xs text-slate-500">{d.lab.abnormal} abnormal results</span>}>
          <p className="mb-3 text-sm">
            {d.lab.ordered} tests ordered · {d.lab.verified} verified
          </p>
          {d.lab.topTests.length ? <BarList items={d.lab.topTests.map((x) => ({ key: x.name, label: x.name, value: x.count, display: String(x.count) }))} /> : empty}
        </Panel>

        <Panel title="Pharmacy" action={<span className="text-xs text-slate-500">sales {etb(d.pharmacy.sales)}</span>}>
          <p className="mb-3 text-sm">{d.pharmacy.unitsDispensed} units dispensed</p>
          {d.pharmacy.topDrugs.length ? <BarList items={d.pharmacy.topDrugs.map((x) => ({ key: x.name, label: x.name, value: x.units, display: String(x.units) }))} /> : empty}
        </Panel>

        <Panel title="Stock" action={<Link href="/inventory" className="text-xs text-brand-700 hover:underline dark:text-brand-400">Inventory</Link>}>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt>Value on shelf (cost)</dt>
            <dd className="text-right tabular-nums">{etb(d.stock.value)}</dd>
            <dt>Low-stock drugs</dt>
            <dd className={`text-right tabular-nums ${d.stock.low ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{d.stock.low}</dd>
            <dt>Expiring within 90 days</dt>
            <dd className="text-right tabular-nums">{d.stock.expiring}</dd>
            <dt>Expired still on shelf</dt>
            <dd className={`text-right tabular-nums ${d.stock.expiredOnShelf ? "font-medium text-red-700 dark:text-red-400" : ""}`}>{d.stock.expiredOnShelf}</dd>
            <dt>Lost in this period</dt>
            <dd className={`text-right tabular-nums ${losses ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
              {etb(losses)}
            </dd>
          </dl>
          {losses > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Expired {etb(d.stock.expiredLoss)} · damaged, lost or corrected {etb(d.stock.adjustmentLoss)}
            </p>
          )}
        </Panel>

        <Panel title="Patients seen by doctor">
          {d.patients.byDoctor.length ? <BarList items={d.patients.byDoctor.map((x) => ({ key: x.name, label: `Dr. ${x.name}`, value: x.count, display: String(x.count) }))} /> : empty}
        </Panel>
      </div>
    </div>
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="ሪፖርቶች · how the clinic is doing"
        actions={
          <Link href="/reports/moh" className={secondaryButtonClass}>
            <FileText aria-hidden />
            Monthly MoH report
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Report searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

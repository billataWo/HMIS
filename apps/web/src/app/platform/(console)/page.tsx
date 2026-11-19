import { AlertTriangle, ArrowRight, Banknote, Building2, Check, CircleDashed, FileText, Inbox, Receipt, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { BarList, ColumnChart } from "@/components/charts";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { etb } from "@/lib/format";
import { type HistoryEntry, METHOD_LABEL, type Metrics, type OperatorMe, type OperatorRow, type Overview, platformApi, type PlatformSettings } from "@/lib/platform";
import { PaymentReview } from "../forms";
import { birr, change, date, monthName, StateBadge } from "./bits";

function Stat({ href, label, value, hint, icon: Icon, tone = "default" }: { href: string; label: string; value: ReactNode; hint?: ReactNode; icon: typeof Inbox; tone?: "default" | "attention" }) {
  return (
    <Link
      href={href}
      className={`surface group block p-4 transition-colors duration-150 hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:hover:border-brand-700 ${
        tone === "attention" ? "ring-1 ring-amber-400/60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <span
          className={`grid size-8 place-items-center rounded-lg ${
            tone === "attention" ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
          }`}
        >
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Link>
  );
}

/** "+12% on October" in green, "−8%" in red. */
function Trend({ now, before, against }: { now: number; before: number; against: string }) {
  const c = change(now, before);
  if (!c) return <>nothing in {against} to compare</>;
  return (
    <>
      <span className={`font-semibold ${c.pct > 0 ? "text-emerald-700 dark:text-emerald-400" : c.pct < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{c.text}</span> on {against}
    </>
  );
}

/** What an owner still has to set up before clinics can be taken on and billed. */
async function SetupChecklist() {
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  if (me.role !== "OWNER") return null;
  const [settings, operators, history] = await Promise.all([
    platformApi<PlatformSettings>("/platform/settings"),
    platformApi<OperatorRow[]>("/platform/operators"),
    platformApi<HistoryEntry[]>("/platform/audit?area=plan"),
  ]);
  const steps = [
    { done: history.length > 0, title: "Set your plans and prices", text: "The three sample plans are shown on the front page until you change them.", href: "/platform/plans" },
    { done: !!(settings.companyName && settings.companyTin), title: "Add your company name and TIN", text: "Printed on every invoice: a tax invoice needs them.", href: "/platform/settings" },
    { done: !!settings.bankDetails, title: "Add the bank account clinics pay into", text: "Shown on every open invoice.", href: "/platform/settings" },
    { done: !!(settings.supportPhone || settings.supportEmail), title: "Add a support phone or email", text: "Shown on the front page and to clinics.", href: "/platform/settings" },
    {
      done: !!(settings.online?.CHAPA || settings.online?.TELEBIRR),
      title: "Turn on online payment",
      text: "Chapa or telebirr keys in the server's environment (docs/saas/README.md).",
      href: "/platform/settings",
    },
    { done: !!settings.licences, title: "Licences for clinic servers", text: settings.licenceProblem ?? "Ready.", href: "/platform/settings" },
    { done: operators.length > 1, title: "Add your team", text: "Support and billing staff, each with their own sign-in.", href: "/platform/operators" },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const front = settings.publicUrl ? `${settings.publicUrl}/welcome` : null;

  return (
    <Card
      title="Get ready for clinics"
      description={`${done} of ${steps.length} done. Only owners see this.`}
      actions={
        <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      }
    >
      <ol className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
        {steps.map((s) => (
          <li key={s.title}>
            <Link href={s.href} className="group flex items-start gap-3 rounded-lg py-3 hover:bg-slate-50 dark:hover:bg-slate-900/60">
              {s.done ? (
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                  <Check aria-hidden className="size-3.5" />
                  <span className="sr-only">Done:</span>
                </span>
              ) : (
                <CircleDashed aria-label="To do:" className="mt-0.5 size-5 shrink-0 text-slate-400" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${s.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900 dark:text-white"}`}>{s.title}</span>
                {!s.done && <span className="block text-sm text-slate-500">{s.text}</span>}
              </span>
              {!s.done && <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />}
            </Link>
          </li>
        ))}
      </ol>
      {front && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          The front page clinics see:{" "}
          <a href={front} target="_blank" rel="noreferrer" className="font-medium break-all text-brand-700 underline-offset-4 hover:underline dark:text-brand-400">
            {front}
          </a>
        </p>
      )}
    </Card>
  );
}

/** The rest are a click away: a long list here would push everything else off the screen. */
const ATTENTION_SHOWN = 8;

async function Content() {
  const [o, m] = await Promise.all([platformApi<Overview>("/platform/overview"), platformApi<Metrics>("/platform/metrics")]);
  const clinics = o.counts.active + o.counts.trial + o.counts.overdue;
  const late = Object.entries(m.receivables.ageing)
    .filter(([k]) => k !== "current")
    .reduce((t, [, v]) => ({ count: t.count + v.count, amount: t.amount + Number(v.amount) }), { count: 0, amount: 0 });
  const toDo = [
    o.pendingRequests > 0 && { href: "/platform/requests", text: `${o.pendingRequests} request${o.pendingRequests === 1 ? "" : "s"} to decide` },
    o.pendingPayments.length > 0 && { href: "#confirm", text: `${o.pendingPayments.length} payment${o.pendingPayments.length === 1 ? "" : "s"} to confirm` },
    late.count > 0 && { href: "/platform/billing?status=OVERDUE", text: `${late.count} overdue invoice${late.count === 1 ? "" : "s"}` },
    o.unappliedCheckouts.length > 0 && { href: "#unapplied", text: `${o.unappliedCheckouts.length} online payment${o.unappliedCheckouts.length === 1 ? "" : "s"} not applied` },
  ].filter((x): x is { href: string; text: string } => !!x);
  const lastMonth = m.months[m.months.length - 2];
  const recent = m.months.slice(-6);

  return (
    <div className="space-y-6">
      {toDo.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="font-medium text-amber-900 dark:text-amber-100">To do:</span>
          {toDo.map((t, n) => (
            <span key={t.href} className="flex items-center gap-3">
              {n > 0 && <span aria-hidden className="text-amber-400">·</span>}
              <Link href={t.href} className="font-medium text-amber-900 underline-offset-4 hover:underline dark:text-amber-100">
                {t.text}
              </Link>
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          href="/platform/clinics?sort=mrr"
          label="Monthly recurring revenue"
          value={birr(m.mrr)}
          hint={`${birr(m.arr)} a year · ${m.paying} paying clinic${m.paying === 1 ? "" : "s"}`}
          icon={TrendingUp}
        />
        <Stat
          href="/platform/billing/payments"
          label={`Collected in ${monthName(m.months[m.months.length - 1].month)}`}
          value={birr(m.collectedThisMonth)}
          hint={<Trend now={Number(m.collectedThisMonth)} before={Number(m.collectedLastMonth)} against={monthName(lastMonth.month)} />}
          icon={Wallet}
        />
        <Stat
          href="/platform/billing?status=OPEN"
          label="Clinics owe"
          value={birr(m.receivables.total)}
          hint={late.count ? <span className="font-medium text-red-700 dark:text-red-400">{birr(late.amount)} overdue</span> : "Nothing overdue"}
          icon={FileText}
          tone={late.count ? "attention" : "default"}
        />
        <Stat
          href="/platform/clinics"
          label="Clinics"
          value={clinics}
          hint={`${o.counts.trial} on trial · ${o.counts.overdue} overdue · ${o.counts.suspended} suspended`}
          icon={Building2}
          tone={o.pendingRequests ? "attention" : "default"}
        />
      </div>

      <Suspense fallback={null}>
        <SetupChecklist />
      </Suspense>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Card title="Money collected" description={`Confirmed payments, month by month: ${etb(m.collected12Months)} over 12 months.`} className="xl:col-span-2">
          <ColumnChart
            title="Collected"
            points={m.months.map((x) => ({ label: x.month, value: Number(x.collected), display: etb(x.collected) }))}
            tick={(ym) => monthName(ym)}
            ariaLabel="Money collected in each of the last 12 months"
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">As a table</summary>
            <table className="mt-2 w-full">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {m.months.map((x) => (
                  <tr key={x.month}>
                    <td className="py-1">{monthName(x.month, true)}</td>
                    <td className="py-1 text-right tabular-nums">{etb(x.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
        <Card title="Recurring revenue by plan" description="What each plan brings in a month; paying clinics in brackets.">
          {m.byPlan.length ? (
            <BarList
              items={m.byPlan.map((p) => ({
                key: p.code,
                label: (
                  <span title={`${p.paying} paying of ${p.clinics} clinics`}>
                    {p.plan} <span className="text-slate-500 tabular-nums">({p.paying})</span>
                  </span>
                ),
                value: Number(p.mrr),
                display: etb(p.mrr),
              }))}
            />
          ) : (
            <p className="text-sm text-slate-500">No clinics on a plan yet.</p>
          )}
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card title="Payments to confirm" description="Bank transfers the clinics reported: check the statement, then confirm.">
          <div id="confirm" className="scroll-mt-24" />
          {o.pendingPayments.length ? (
            <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
              {o.pendingPayments.map((p) => (
                <li key={p.id} className="space-y-2 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <Link href={`/platform/clinics/${p.tenantId}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                      {p.clinic}
                    </Link>
                    <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{etb(p.amount)}</span>
                  </div>
                  <p className="text-slate-500">
                    Invoice{" "}
                    <Link href={`/platform/invoice/${p.invoiceId}`} className="font-mono hover:underline">
                      {p.invoice.number}
                    </Link>{" "}
                    · transaction <span className="font-mono text-slate-700 dark:text-slate-300">{p.reference}</span> · paid {date(p.paidAt)}
                  </p>
                  <PaymentReview paymentId={p.id} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Banknote} title="Nothing to confirm">
              Bank transfers that clinics report appear here.
            </EmptyState>
          )}
        </Card>

        <Card title="Needs attention" description="Trials and paid periods ending within 7 days, overdue and suspended clinics.">
          {o.attention.length ? (
            <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
              {o.attention.slice(0, ATTENTION_SHOWN).map((a) => (
                <li key={a.tenantId}>
                  <Link href={`/platform/clinics/${a.tenantId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <span className="font-medium text-slate-900 dark:text-white">{a.name}</span>
                    <StateBadge state={a.state} />
                    <span className="ml-auto text-slate-500">
                      {a.state === "suspended" ? `read-only since ${date(a.endsAt)} + grace` : `ends ${date(a.endsAt)}`}
                      {a.daysLeft !== null && a.state !== "suspended" && ` · ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Check} title="All clinics are in order">
              Nothing ends in the next 7 days.
            </EmptyState>
          )}
          {o.attention.length > ATTENTION_SHOWN && (
            <Link href="/platform/clinics?sort=ends" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
              {o.attention.length - ATTENTION_SHOWN} more: see the clinics <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Card title="Growth" description="The last 90 days.">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-slate-500">Trials that became paying</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{m.conversion.rate === null ? "—" : `${Math.round(m.conversion.rate * 100)}%`}</dd>
              <dd className="text-xs text-slate-500">
                {m.conversion.converted} of {m.conversion.ended} ended trials
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Trials ending in 30 days</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{m.trialsEndingSoon}</dd>
              <dd className="text-xs text-slate-500">invoice them in time</dd>
            </div>
            <div>
              <dt className="text-slate-500">Clinics that left</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{m.churn.cancelled}</dd>
              <dd className="text-xs text-slate-500">{Number(m.churn.lostMrr) ? `${birr(m.churn.lostMrr)} a month lost` : "no revenue lost"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Average per paying clinic</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{birr(m.arpa)}</dd>
              <dd className="text-xs text-slate-500">a month</dd>
            </div>
          </dl>
        </Card>
        <Card title="Joining and leaving" description="New clinics and cancellations, the last 6 months.">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Month</th>
                <th className="pb-2 text-right font-medium">Joined</th>
                <th className="pb-2 text-right font-medium">Left</th>
                <th className="pb-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {recent.map((x) => {
                const net = x.newClinics - x.cancelled;
                return (
                  <tr key={x.month}>
                    <td className="py-1.5">{monthName(x.month, true)}</td>
                    <td className="py-1.5 text-right tabular-nums">{x.newClinics}</td>
                    <td className="py-1.5 text-right tabular-nums">{x.cancelled}</td>
                    <td className={`py-1.5 text-right font-medium tabular-nums ${net > 0 ? "text-emerald-700 dark:text-emerald-400" : net < 0 ? "text-red-700 dark:text-red-400" : "text-slate-500"}`}>
                      {net > 0 ? `+${net}` : net < 0 ? `−${-net}` : "0"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="How clinics pay" description="Confirmed payments over 12 months.">
          {m.byMethod.length ? (
            <BarList items={m.byMethod.map((x) => ({ key: x.method, label: METHOD_LABEL[x.method] ?? x.method, value: Number(x.amount), display: etb(x.amount) }))} />
          ) : (
            <p className="text-sm text-slate-500">No payments yet.</p>
          )}
        </Card>
      </div>

      {o.unappliedCheckouts.length > 0 && (
        <Card title="Paid online, not applied" description="The clinic paid, but the invoice was meanwhile paid another way or voided: refund it, or record it on another invoice.">
          <div id="unapplied" className="scroll-mt-24" />
          <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
            {o.unappliedCheckouts.slice(0, 5).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                <Receipt aria-hidden className="size-4 text-amber-600" />
                <Link href={`/platform/clinics/${c.tenantId}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                  {c.clinic}
                </Link>
                <span className="tabular-nums">
                  {etb(c.amount)} by {c.provider === "CHAPA" ? "Chapa" : "telebirr"}
                </span>
                <span className="font-mono text-slate-600 dark:text-slate-300">{c.reference}</span>
                <span className="w-full text-slate-500">{c.lastError}</span>
              </li>
            ))}
          </ul>
          {o.unappliedCheckouts.length > 5 && <p className="mt-3 text-sm text-slate-500">And {o.unappliedCheckouts.length - 5} more: each is on its clinic&apos;s page, under Online payments.</p>}
        </Card>
      )}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="HMIS as a service: the business at a glance, and what needs you today." />
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <Skeleton className="h-72" />
          </div>
        }
      >
        <Content />
      </Suspense>
    </>
  );
}

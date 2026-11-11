import { AlertTriangle, ArrowRight, Banknote, Building2, Check, CircleDashed, FileText, Inbox, Receipt, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { etb } from "@/lib/format";
import { type HistoryEntry, type OperatorMe, type OperatorRow, type Overview, platformApi, type PlatformSettings } from "@/lib/platform";
import { PaymentReview } from "../forms";
import { date, StateBadge } from "./bits";

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
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Link>
  );
}

/** What an owner still has to set up before clinics can be taken on and billed. */
async function SetupChecklist() {
  const me = await platformApi<OperatorMe>("/platform/auth/me");
  if (me.role !== "OWNER") return null;
  const [settings, operators, history] = await Promise.all([
    platformApi<PlatformSettings>("/platform/settings"),
    platformApi<OperatorRow[]>("/platform/operators"),
    platformApi<HistoryEntry[]>("/platform/audit"),
  ]);
  const steps = [
    { done: history.some((h) => h.action.startsWith("plan.")), title: "Set your plans and prices", text: "The three sample plans are shown on the front page until you change them.", href: "/platform/plans" },
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
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
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
  const o = await platformApi<Overview>("/platform/overview");
  const clinics = o.counts.active + o.counts.trial + o.counts.overdue;
  const toDo = o.pendingRequests + o.pendingPayments.length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          href="/platform/requests"
          label="Requests waiting"
          value={o.pendingRequests}
          hint={o.pendingRequests ? "Call each clinic, then decide" : "Nothing to decide"}
          icon={Inbox}
          tone={o.pendingRequests ? "attention" : "default"}
        />
        <Stat href="/platform/clinics" label="Clinics" value={clinics} hint={`${o.counts.trial} on trial · ${o.counts.overdue} overdue · ${o.counts.suspended} suspended`} icon={Building2} />
        <Stat href="/platform/clinics" label="Monthly recurring" value={etb(o.monthlyRecurring)} hint="Paying clinics, before VAT" icon={TrendingUp} />
        <Stat href="/platform/clinics" label="Open invoices" value={o.openInvoices.count} hint={etb(o.openInvoices.total)} icon={FileText} />
      </div>

      <Suspense fallback={null}>
        <SetupChecklist />
      </Suspense>

      {toDo > 0 && (
        <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
          <AlertTriangle aria-hidden className="size-4" />
          {[
            o.pendingRequests && `${o.pendingRequests} request${o.pendingRequests === 1 ? "" : "s"} to decide`,
            o.pendingPayments.length && `${o.pendingPayments.length} payment${o.pendingPayments.length === 1 ? "" : "s"} to confirm`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card title="Payments to confirm" description="Bank transfers the clinics reported: check the statement, then confirm.">
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
                    Invoice {p.invoice.number} · transaction <span className="font-mono text-slate-700 dark:text-slate-300">{p.reference}</span> · paid {date(p.paidAt)}
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
          ) : null}
          {o.attention.length > ATTENTION_SHOWN && (
            <Link href="/platform/clinics" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
              {o.attention.length - ATTENTION_SHOWN} more: see the clinics <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
          {o.attention.length ? null : (
            <EmptyState icon={Check} title="All clinics are in order">
              Nothing ends in the next 7 days.
            </EmptyState>
          )}
        </Card>
      </div>

      {o.unappliedCheckouts.length > 0 && (
        <Card title="Paid online, not applied" description="The clinic paid, but the invoice was meanwhile paid another way or voided: refund it, or record it on another invoice.">
          <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
            {o.unappliedCheckouts.map((c) => (
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
        </Card>
      )}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="HMIS as a service: what needs you today" />
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

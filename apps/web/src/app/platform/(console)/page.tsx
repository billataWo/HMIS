import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader, Skeleton, StatCard } from "@/components/ui";
import { etb } from "@/lib/format";
import { type Overview, platformApi } from "@/lib/platform";
import { PaymentReview } from "../forms";
import { date, StateBadge } from "./bits";

async function Content() {
  const o = await platformApi<Overview>("/platform/overview");
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Requests waiting" value={<Link href="/platform/requests">{o.pendingRequests}</Link>} />
        <StatCard label="Clinics" value={o.counts.active + o.counts.trial + o.counts.overdue} hint={`${o.counts.trial} on trial · ${o.counts.overdue} overdue · ${o.counts.suspended} suspended`} />
        <StatCard label="Monthly recurring" value={etb(o.monthlyRecurring)} hint="Paying clinics, before VAT" />
        <StatCard label="Open invoices" value={o.openInvoices.count} hint={etb(o.openInvoices.total)} />
      </div>

      <Card title="Payments to confirm" description="Bank transfers the clinics reported: check the statement, then confirm.">
        {o.pendingPayments.length ? (
          <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
            {o.pendingPayments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                <Link href={`/platform/clinics/${p.tenantId}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                  {p.clinic}
                </Link>
                <span>
                  {etb(p.amount)} for {p.invoice.number}
                </span>
                <span className="font-mono">{p.reference}</span>
                <span className="text-slate-500">paid {date(p.paidAt)}</span>
                <div className="ml-auto">
                  <PaymentReview paymentId={p.id} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing to confirm" />
        )}
      </Card>

      {o.unappliedCheckouts.length > 0 && (
        <Card title="Paid online, not applied" description="The clinic paid, but the invoice was meanwhile paid another way or voided: refund it, or record it on another invoice.">
          <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
            {o.unappliedCheckouts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                <Link href={`/platform/clinics/${c.tenantId}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                  {c.clinic}
                </Link>
                <span>
                  {etb(c.amount)} by {c.provider === "CHAPA" ? "Chapa" : "telebirr"}
                </span>
                <span className="font-mono">{c.reference}</span>
                <span className="text-slate-500">{c.lastError}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Needs attention" description="Trials and paid periods ending within 7 days, overdue and suspended clinics.">
        {o.attention.length ? (
          <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-800">
            {o.attention.map((a) => (
              <li key={a.tenantId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <Link href={`/platform/clinics/${a.tenantId}`} className="font-medium text-slate-900 hover:underline dark:text-white">
                  {a.name}
                </Link>
                <StateBadge state={a.state} />
                <span className="text-slate-500">
                  {a.state === "suspended" ? `read-only since ${date(a.endsAt)} + grace` : `ends ${date(a.endsAt)}`}
                  {a.daysLeft !== null && a.state !== "suspended" && ` (${a.daysLeft} days)`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="All clinics are in order" />
        )}
      </Card>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="HMIS as a service" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}

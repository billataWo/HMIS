import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, EmptyState, Notice, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { clinicToday, etb } from "@/lib/format";
import { type ClinicDetail, DEPLOYMENT_LABEL, type Plan, platformApi } from "@/lib/platform";
import { ClinicActions, DeleteClinicData, DownloadLicence, InvoiceActions, IssueInvoice, PaymentReview, SubscriptionForm } from "../../../forms";
import { date, dateTime, StateBadge, tdClass, thClass } from "../../bits";

const INVOICE = { OPEN: { label: "Open", tone: "warning" }, PAID: { label: "Paid", tone: "success" }, VOID: { label: "Void", tone: "neutral" } } as const;
const PAYMENT = { PENDING: { label: "To confirm", tone: "warning" }, CONFIRMED: { label: "Confirmed", tone: "success" }, REJECTED: { label: "Rejected", tone: "neutral" } } as const;

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, { plans }] = await Promise.all([platformApi<ClinicDetail>(`/platform/clinics/${id}`), platformApi<{ plans: Plan[] }>("/platform/plans")]);
  const s = c.subscription;
  const today = clinicToday();
  const paidOn = (invoiceId: string) => c.payments.filter((p) => p.invoiceId === invoiceId && p.status === "CONFIRMED").reduce((sum, p) => sum + Number(p.amount), 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title={c.tenant.name}
        subtitle={[c.tenant.nameAm, c.tenant.address, `since ${date(c.tenant.createdAt)}`].filter(Boolean).join(" · ")}
        actions={
          <Link href="/platform/clinics" className={secondaryButtonClass}>
            All clinics
          </Link>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <Card
          title="Subscription"
          actions={s && <StateBadge state={s.state} />}
          description={
            s
              ? `${s.plan.name} · ${s.billingCycle === "YEARLY" ? `${etb(s.plan.priceYearly)} a year` : `${etb(s.plan.priceMonthly)} a month`} · ${DEPLOYMENT_LABEL[s.deployment]}`
              : "Not billed: this clinic has no limits. Choose a plan to start billing it."
          }
        >
          {s && (
            <div className="mb-4 space-y-2 text-sm">
              <p>
                {s.status === "TRIAL" ? "Trial ends" : "Paid until"}: <strong>{s.endsAt ? date(s.endsAt) : "no end date"}</strong>
                {s.graceEndsAt && s.state !== "suspended" && <span className="text-slate-500"> · read-only from {date(s.graceEndsAt)} if not paid</span>}
              </p>
              {s.suspendReason && <Notice tone="danger">Suspended by HMIS: {s.suspendReason}</Notice>}
              {s.cancelReason && <Notice tone="info">Cancelled: {s.cancelReason}</Notice>}
            </div>
          )}
          <SubscriptionForm tenantId={c.tenant.id} sub={s} plans={plans} />
          {s && s.deployment !== "CLOUD" && (
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
              <p className="text-slate-600 dark:text-slate-300">
                {s.deployment === "CLINIC_SERVER"
                  ? "Its clinic server fetches a new licence every hour by itself. A file is only needed if it cannot reach the cloud."
                  : "Send the licence file to the clinic after each payment: the admin installs it in Settings → Subscription."}
              </p>
              <DownloadLicence tenantId={c.tenant.id} />
            </div>
          )}
          {s && (
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <ClinicActions tenantId={c.tenant.id} state={s.state} />
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Use">
            <dl className="grid grid-cols-3 gap-3 text-center text-sm">
              {(
                [
                  ["Staff", c.counts.staff],
                  ["Patients", c.counts.patients],
                  ["Visits", c.counts.visits],
                ] as const
              ).map(([label, n]) => (
                <div key={label}>
                  <dd className="text-xl font-semibold text-slate-900 tabular-nums dark:text-white">{n}</dd>
                  <dt className="text-slate-500">{label}</dt>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Admins">
            <ul className="space-y-2 text-sm">
              {c.admins.map((a) => (
                <li key={a.id}>
                  {a.fullName} <span className="text-slate-500">{a.phone}</span>
                  <p className="text-xs text-slate-500">
                    {a.active ? "active" : "inactive"} · two-step {a.totpEnabledAt ? "on" : "not set up yet"}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">A locked-out admin with no other admin: on the server, deploy/hmis clinic reset-admin &lt;phone&gt;.</p>
          </Card>
          {c.request && (
            <Card title="Request">
              <p className="text-sm">
                <Link href={`/platform/requests/${c.request.id}`} className="font-mono underline">
                  {c.request.reference}
                </Link>{" "}
                from {c.request.contactName}, {c.request.contactPhone}
              </p>
            </Card>
          )}
        </div>
      </div>

      {s && (
        <Card title="Invoices" actions={<IssueInvoice tenantId={c.tenant.id} />}>
          {c.invoices.length ? (
            <ul className="-my-4 divide-y divide-slate-100 dark:divide-slate-800">
              {c.invoices.map((i) => (
                <li key={i.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span className="font-mono font-medium">{i.number}</span>
                    <span className="text-slate-500">
                      {i.planName}, {date(i.periodStart)} – {date(i.periodEnd)} · due {date(i.dueDate)}
                    </span>
                    <span className="ml-auto font-semibold tabular-nums">{etb(i.total)}</span>
                    <Badge tone={INVOICE[i.status].tone}>{INVOICE[i.status].label}</Badge>
                  </div>
                  {i.voidReason && <p className="text-xs text-slate-500">{i.voidReason}</p>}
                  {i.status === "OPEN" && <InvoiceActions invoiceId={i.id} balance={(Number(i.total) - paidOn(i.id)).toFixed(2)} today={today} />}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No invoices yet">Issue the first one before the trial ends.</EmptyState>
          )}
        </Card>
      )}

      {c.payments.length > 0 && (
        <Card title="Payments" className="overflow-x-auto">
          <table className="-m-5 w-[calc(100%+2.5rem)] text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className={thClass}>Invoice</th>
                <th className={thClass}>Amount</th>
                <th className={thClass}>How</th>
                <th className={thClass}>Reference</th>
                <th className={thClass}>Paid</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {c.payments.map((p) => (
                <tr key={p.id}>
                  <td className={`${tdClass} font-mono`}>{p.invoice.number}</td>
                  <td className={`${tdClass} tabular-nums`}>{etb(p.amount)}</td>
                  <td className={tdClass}>{p.method.replace("_", " ").toLowerCase()}</td>
                  <td className={`${tdClass} font-mono`}>{p.reference ?? "—"}</td>
                  <td className={tdClass}>{date(p.paidAt)}</td>
                  <td className={tdClass}>
                    {p.status === "PENDING" ? (
                      <PaymentReview paymentId={p.id} />
                    ) : (
                      <>
                        <Badge tone={PAYMENT[p.status].tone}>{PAYMENT[p.status].label}</Badge>
                        {p.rejectReason && <p className="text-xs text-slate-500">{p.rejectReason}</p>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {c.checkouts.length > 0 && (
        <Card title="Online payments" description="Each time the clinic went to Chapa or telebirr to pay." className="overflow-x-auto">
          <table className="-m-5 w-[calc(100%+2.5rem)] text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className={thClass}>Started</th>
                <th className={thClass}>Provider</th>
                <th className={thClass}>Amount</th>
                <th className={thClass}>Reference</th>
                <th className={thClass}>Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {c.checkouts.map((k) => (
                <tr key={k.id}>
                  <td className={tdClass}>{dateTime(k.createdAt)}</td>
                  <td className={tdClass}>{k.provider === "CHAPA" ? "Chapa" : "telebirr"}</td>
                  <td className={`${tdClass} tabular-nums`}>{etb(k.amount)}</td>
                  <td className={`${tdClass} font-mono text-xs`}>{k.reference}</td>
                  <td className={tdClass}>
                    {k.status === "PAID" ? (k.paymentId ? "Paid" : "Paid, not applied") : k.status === "CREATED" ? "Not finished" : k.status.toLowerCase()}
                    {k.lastError && <p className="text-xs text-slate-500">{k.lastError}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {s?.cancelledAt && (
        <Card title="The clinic's records" description="After a clinic leaves, it has time to download its data; then its records can be deleted.">
          <div className="space-y-3 text-sm">
            <p>
              Cancelled {date(s.cancelledAt)}. Last export by the clinic: {c.lastExportAt ? dateTime(c.lastExportAt) : "never"}.
            </p>
            {s.dataDeletedAt ? (
              <Notice tone="info">The records were deleted {dateTime(s.dataDeletedAt)}.</Notice>
            ) : c.deletableFrom && new Date(c.deletableFrom) > new Date() ? (
              <p className="text-slate-500">They can be deleted from {date(c.deletableFrom)}.</p>
            ) : (
              <DeleteClinicData tenantId={c.tenant.id} name={c.tenant.name} />
            )}
          </div>
        </Card>
      )}

      <Card title="History">
        {c.history.length ? (
          <ul className="space-y-1.5 text-sm">
            {c.history.map((h) => (
              <li key={h.id}>
                <span className="text-slate-500">{dateTime(h.createdAt)}</span> {h.action}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Nothing yet.</p>
        )}
      </Card>
    </div>
  );
}

export default function ClinicPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content params={params} />
    </Suspense>
  );
}

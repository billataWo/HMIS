import { Check } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, type BadgeTone, Card, EmptyState, Notice, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type ClinicSubscription, type Me, type PlatformInvoice, type SubscriptionState } from "@/lib/api";
import { clinicToday, etb, formatDualDate } from "@/lib/format";
import { PayOnline } from "./pay-online";
import { LicenceForm } from "./licence-form";
import { TransferForm } from "./transfer-form";

const STATE: Record<SubscriptionState, { label: string; tone: BadgeTone }> = {
  trial: { label: "Free trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  overdue: { label: "Overdue", tone: "warning" },
  suspended: { label: "Suspended: read-only", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const INVOICE: Record<PlatformInvoice["status"], { label: string; tone: BadgeTone }> = {
  OPEN: { label: "To pay", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Cancelled", tone: "neutral" },
};
const PAYMENT: Record<string, string> = { PENDING: "waiting for HMIS to confirm", CONFIRMED: "confirmed", REJECTED: "not found by HMIS" };
const DEPLOYMENT = { CLOUD: "HMIS cloud", CLINIC_SERVER: "Clinic server, synced to the cloud", ON_PREMISE: "Clinic server" };

const day = (iso: string) => formatDualDate(iso);

function Status({ s }: { s: Extract<ClinicSubscription, { managed: true }> & { plan: NonNullable<Extract<ClinicSubscription, { managed: true }>["plan"]> } }) {
  const st = STATE[s.state];
  const price = !s.plan.priceMonthly ? null : s.billingCycle === "YEARLY" ? `${etb(s.plan.priceYearly!)} a year` : `${etb(s.plan.priceMonthly)} a month`;
  return (
    <Card title="Your plan" actions={<Badge tone={st.tone} dot>{st.label}</Badge>}>
      <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Plan</dt>
          <dd className="font-medium text-slate-900 dark:text-white">
            {s.plan.name}
            {price && ` · ${price} + VAT`}
          </dd>
          {s.plan.description && <dd className="mt-0.5 text-slate-500">{s.plan.description}</dd>}
        </div>
        <div>
          <dt className="text-slate-500">{s.state === "trial" ? "Trial ends" : "Paid until"}</dt>
          <dd className="font-medium text-slate-900 dark:text-white">{s.endsAt ? day(s.endsAt) : s.state === "trial" ? "—" : "No end date"}</dd>
          {s.state === "overdue" && s.graceEndsAt && <dd className="mt-0.5 text-amber-700 dark:text-amber-300">Read-only from {day(s.graceEndsAt)} unless paid</dd>}
          {s.suspendReason && <dd className="mt-0.5 text-red-700 dark:text-red-300">{s.suspendReason}</dd>}
        </div>
        <div>
          <dt className="text-slate-500">Staff accounts</dt>
          <dd className="font-medium text-slate-900 dark:text-white">
            {s.activeStaff} active{s.plan.maxStaff !== null ? ` of ${s.plan.maxStaff} allowed` : ", no limit"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Runs on</dt>
          <dd className="font-medium text-slate-900 dark:text-white">{DEPLOYMENT[s.deployment]}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Included</dt>
          <dd className="mt-1 flex flex-wrap gap-2">
            <Badge tone="brand">Registration, queue, consultation, lab, pharmacy, billing, reports</Badge>
            {s.plan.features.map((f) => (
              <Badge key={f.code} tone="brand">
                <Check aria-hidden className="size-3" /> {f.name}
              </Badge>
            ))}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function Invoice({ invoice, bankDetails, online }: { invoice: PlatformInvoice; bankDetails: string | null; online: { CHAPA: boolean; TELEBIRR: boolean } }) {
  const st = INVOICE[invoice.status];
  const due = Math.max(0, Number(invoice.total) - Number(invoice.paid));
  const pending = invoice.payments.some((p) => p.status === "PENDING");
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="font-mono text-sm font-medium text-slate-900 dark:text-white">{invoice.number}</p>
        <p className="text-sm text-slate-500">
          {invoice.planName}, {day(invoice.periodStart)} – {day(invoice.periodEnd)}
        </p>
        <p className="ml-auto text-sm font-semibold text-slate-900 tabular-nums dark:text-white">{etb(invoice.total)}</p>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="text-xs text-slate-500">
        {etb(invoice.subtotal)} + VAT {etb(invoice.vat)}
        {invoice.status === "OPEN" && ` · due ${day(invoice.dueDate)}`}
        {invoice.status === "PAID" && invoice.paidAt && ` · paid ${day(invoice.paidAt)}`}
        {invoice.voidReason && ` · ${invoice.voidReason}`}
      </p>
      {invoice.payments.length > 0 && (
        <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          {invoice.payments.map((p) => (
            <li key={p.id}>
              {etb(p.amount)} by {p.method === "BANK_TRANSFER" ? "bank transfer" : p.method.toLowerCase()}
              {p.reference && <span className="font-mono"> {p.reference}</span>} on {day(p.paidAt)}: {PAYMENT[p.status]}
              {p.rejectReason && ` (${p.rejectReason})`}
            </li>
          ))}
        </ul>
      )}
      {invoice.status === "OPEN" && !pending && (
        <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          {(online.CHAPA || online.TELEBIRR) && (
            <div className="space-y-2 border-b border-slate-100 pb-4 dark:border-slate-800">
              <p className="text-sm font-medium text-slate-900 dark:text-white">Pay now: {etb(due)}</p>
              <PayOnline invoiceId={invoice.id} chapa={online.CHAPA} telebirr={online.TELEBIRR} />
            </div>
          )}
          {bankDetails ? (
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{online.CHAPA || online.TELEBIRR ? "Or pay by bank transfer to" : "Pay by bank transfer to"}</p>
              <p className="mt-1 text-sm whitespace-pre-line text-slate-600 dark:text-slate-300">{bankDetails}</p>
              <p className="mt-1 text-xs text-slate-500">Write {invoice.number} as the reason for the transfer.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">Ask HMIS how to pay this invoice (contact below).</p>
          )}
          <TransferForm invoiceId={invoice.id} amount={due.toFixed(2)} today={clinicToday()} />
        </div>
      )}
    </li>
  );
}

/** A clinic server or own-server install: the plan comes from its HMIS licence. */
function LicenceView({ s }: { s: Extract<ClinicSubscription, { managed: true }> }) {
  const l = s.licence;
  return (
    <div className="space-y-6">
      {s.unlicensed ? (
        <Notice tone="danger">This server has no valid HMIS licence, so it is read-only. Install the licence file HMIS gave you below.</Notice>
      ) : (
        s.readOnly && <Notice tone="danger">The licence has run out: the clinic is read-only until a new licence is installed.</Notice>
      )}
      {s.plan && <Status s={{ ...s, plan: s.plan }} />}
      <Card title="HMIS licence" description={l ? `Issued ${day(l.issuedAt)} · ${l.source === "sync" ? "renewed from the HMIS cloud every hour" : "installed from a file"}` : "None installed"}>
        <div className="space-y-4 text-sm">
          {s.payAt ? (
            <p className="text-slate-600 dark:text-slate-300">
              This clinic server gets its licence from the HMIS cloud by itself. To pay HMIS, sign in at{" "}
              <a href={s.payAt} className="font-medium text-brand-700 underline dark:text-brand-400">
                {new URL(s.payAt).host}
              </a>{" "}
              (Settings → Subscription): the new licence arrives here within the hour.
            </p>
          ) : (
            <p className="text-slate-600 dark:text-slate-300">
              When the clinic pays HMIS, HMIS sends a new licence file: install it here. The licence works without internet until its date.
            </p>
          )}
          <LicenceForm />
        </div>
      </Card>
    </div>
  );
}

async function Content() {
  const me = await api<Me>("/auth/me");
  if (me.role !== "ADMIN") return <p className="text-sm text-slate-500">Only clinic admins see the subscription.</p>;
  let s: ClinicSubscription;
  try {
    s = await api<ClinicSubscription>("/subscription");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only clinic admins see the subscription.</p>;
    throw e;
  }
  if (!s.managed) {
    return <Notice tone="info">This clinic&apos;s HMIS is not billed as a subscription here, so no plan limits apply.</Notice>;
  }
  if (s.source === "licence") return <LicenceView s={s} />;
  const open = s.invoices.filter((i) => i.status === "OPEN");
  return (
    <div className="space-y-6">
      {s.readOnly && (
        <Notice tone="danger">
          {s.state === "cancelled"
            ? "The subscription has ended: records can be looked at and printed, but nothing new can be saved."
            : "The clinic is read-only until the open invoice is paid. Staff can still look up and print records."}
        </Notice>
      )}
      {s.plan && <Status s={{ ...s, plan: s.plan }} />}
      <Card title="Invoices from HMIS" description={open.length ? `${open.length} to pay` : undefined}>
        {s.invoices.length ? (
          <ul className="-my-4 divide-y divide-slate-100 dark:divide-slate-800">
            {s.invoices.map((i) => (
              <Invoice key={i.id} invoice={i} bankDetails={s.bankDetails} online={s.online} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No invoices yet">
            {s.state === "trial" ? "HMIS sends the first invoice before the free trial ends." : "Invoices from HMIS appear here."}
          </EmptyState>
        )}
      </Card>
      {(s.support.phone || s.support.email) && (
        <p className="text-sm text-slate-500">
          Questions about the subscription, or a different plan: {[s.support.phone, s.support.email].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <>
      <PageHeader
        title="Subscription"
        subtitle="your HMIS plan and invoices"
        actions={
          <Link href="/settings" className={secondaryButtonClass}>
            Settings
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

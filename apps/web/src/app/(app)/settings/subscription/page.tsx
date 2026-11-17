import { Check } from "lucide-react";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Badge, type BadgeTone, Card, EmptyState, Notice, Skeleton } from "@/components/ui";
import { api, ApiError, type ClinicSubscription, type Me, type PlatformInvoice, type SubscriptionState } from "@/lib/api";
import { clinicToday, etb, formatDualDate } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { BackToSettings } from "../back-to-settings";
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

function Status({ s, t }: { s: Extract<ClinicSubscription, { managed: true }> & { plan: NonNullable<Extract<ClinicSubscription, { managed: true }>["plan"]> }; t: T }) {
  const st = STATE[s.state];
  const price = !s.plan.priceMonthly
    ? null
    : s.billingCycle === "YEARLY"
      ? t("{amount} a year", { amount: etb(s.plan.priceYearly!, t) })
      : t("{amount} a month", { amount: etb(s.plan.priceMonthly, t) });
  return (
    <Card title={t("Your plan")} actions={<Badge tone={st.tone} dot>{t(st.label)}</Badge>}>
      <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">{t("Plan")}</dt>
          <dd className="font-medium text-slate-900 dark:text-white">
            {s.plan.name}
            {price && ` · ${t("{price} + VAT", { price })}`}
          </dd>
          {s.plan.description && <dd className="mt-0.5 text-slate-500">{s.plan.description}</dd>}
        </div>
        <div>
          <dt className="text-slate-500">{t(s.state === "trial" ? "Trial ends" : "Paid until")}</dt>
          <dd className="font-medium text-slate-900 dark:text-white">{s.endsAt ? day(s.endsAt) : s.state === "trial" ? "—" : t("No end date")}</dd>
          {s.state === "overdue" && s.graceEndsAt && (
            <dd className="mt-0.5 text-amber-700 dark:text-amber-300">{t("Read-only from {date} unless paid", { date: day(s.graceEndsAt) })}</dd>
          )}
          {s.suspendReason && <dd className="mt-0.5 text-red-700 dark:text-red-300">{t(s.suspendReason)}</dd>}
        </div>
        <div>
          <dt className="text-slate-500">{t("Staff accounts")}</dt>
          <dd className="font-medium text-slate-900 dark:text-white">
            {s.plan.maxStaff !== null
              ? t("{n} active of {max} allowed", { n: s.activeStaff, max: s.plan.maxStaff })
              : t("{n} active, no limit", { n: s.activeStaff })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("Runs on")}</dt>
          <dd className="font-medium text-slate-900 dark:text-white">{t(DEPLOYMENT[s.deployment])}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">{t("Included")}</dt>
          <dd className="mt-1.5">
            <ul className="grid gap-x-6 gap-y-1.5 text-slate-700 sm:grid-cols-2 dark:text-slate-200">
              {[
                ...["Registration, queue and consultation", "Laboratory and pharmacy", "Billing and reports"].map((x) => t(x)),
                ...s.plan.features.map((f) => f.name),
              ].map((name) => (
                <li key={name} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {name}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function Invoice({
  invoice,
  bankDetails,
  online,
  t,
}: {
  invoice: PlatformInvoice;
  bankDetails: string | null;
  online: { CHAPA: boolean; TELEBIRR: boolean };
  t: T;
}) {
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
        <p className="ml-auto text-sm font-semibold text-slate-900 tabular-nums dark:text-white">{etb(invoice.total, t)}</p>
        <Badge tone={st.tone}>{t(st.label)}</Badge>
      </div>
      <p className="text-xs text-slate-500">
        {t("{subtotal} + VAT {vat}", { subtotal: etb(invoice.subtotal, t), vat: etb(invoice.vat, t) })}
        {invoice.status === "OPEN" && ` · ${t("due {date}", { date: day(invoice.dueDate) })}`}
        {invoice.status === "PAID" && invoice.paidAt && ` · ${t("paid {date}", { date: day(invoice.paidAt) })}`}
        {invoice.voidReason && ` · ${invoice.voidReason}`}
      </p>
      {invoice.payments.length > 0 && (
        <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          {invoice.payments.map((p) => (
            <li key={p.id}>
              {t.rich("{amount} by {method}{reference} on {date}: {status}", {
                amount: etb(p.amount, t),
                method: p.method === "BANK_TRANSFER" ? t("bank transfer") : p.method === "CHAPA" ? "Chapa" : p.method === "TELEBIRR" ? "telebirr" : p.method.toLowerCase(),
                reference: p.reference ? <span className="font-mono"> {p.reference}</span> : "",
                date: day(p.paidAt),
                status: t(PAYMENT[p.status] ?? p.status),
              })}
              {p.rejectReason && ` (${p.rejectReason})`}
            </li>
          ))}
        </ul>
      )}
      {invoice.status === "OPEN" && !pending && (
        <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          {(online.CHAPA || online.TELEBIRR) && (
            <div className="space-y-2 border-b border-slate-100 pb-4 dark:border-slate-800">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t("Pay now: {amount}", { amount: etb(due, t) })}</p>
              <PayOnline invoiceId={invoice.id} chapa={online.CHAPA} telebirr={online.TELEBIRR} />
            </div>
          )}
          {bankDetails ? (
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t(online.CHAPA || online.TELEBIRR ? "Or pay by bank transfer to" : "Pay by bank transfer to")}</p>
              <p className="mt-1 text-sm whitespace-pre-line text-slate-600 dark:text-slate-300">{bankDetails}</p>
              <p className="mt-1 text-xs text-slate-500">{t("Write {number} as the reason for the transfer.", { number: invoice.number })}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">{t("Ask HMIS how to pay this invoice (contact below).")}</p>
          )}
          <TransferForm invoiceId={invoice.id} amount={due.toFixed(2)} today={clinicToday()} />
        </div>
      )}
    </li>
  );
}

/** A clinic server or own-server install: the plan comes from its HMIS licence. */
function LicenceView({ s, t }: { s: Extract<ClinicSubscription, { managed: true }>; t: T }) {
  const l = s.licence;
  return (
    <div className="space-y-6">
      {s.unlicensed ? (
        <Notice tone="danger">{t("This server has no valid HMIS licence, so it is read-only. Install the licence file HMIS gave you below.")}</Notice>
      ) : (
        s.readOnly && <Notice tone="danger">{t("The licence has run out: the clinic is read-only until a new licence is installed.")}</Notice>
      )}
      {s.plan && <Status s={{ ...s, plan: s.plan }} t={t} />}
      <Card
        title={t("HMIS licence")}
        description={
          l
            ? `${t("Issued {date}", { date: day(l.issuedAt) })} · ${t(l.source === "sync" ? "renewed from the HMIS cloud every hour" : "installed from a file")}`
            : t("None installed")
        }
      >
        <div className="space-y-4 text-sm">
          {s.payAt ? (
            <p className="text-slate-600 dark:text-slate-300">
              {t.rich(
                "This clinic server gets its licence from the HMIS cloud by itself. To pay HMIS, sign in at {site} (Settings → Subscription): the new licence arrives here within the hour.",
                {
                  site: (
                    <a href={s.payAt} className="font-medium text-brand-700 underline dark:text-brand-400">
                      {new URL(s.payAt).host}
                    </a>
                  ),
                },
              )}
            </p>
          ) : (
            <p className="text-slate-600 dark:text-slate-300">
              {t("When the clinic pays HMIS, HMIS sends a new licence file: install it here. The licence works without internet until its date.")}
            </p>
          )}
          <LicenceForm />
        </div>
      </Card>
    </div>
  );
}

async function Content() {
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (me.role !== "ADMIN") return <p className="text-sm text-slate-500">{t("Only clinic admins see the subscription.")}</p>;
  let s: ClinicSubscription;
  try {
    s = await api<ClinicSubscription>("/subscription");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only clinic admins see the subscription.")}</p>;
    throw e;
  }
  if (!s.managed) {
    return <Notice tone="info">{t("This clinic's HMIS is not billed as a subscription here, so no plan limits apply.")}</Notice>;
  }
  if (s.source === "licence") return <LicenceView s={s} t={t} />;
  const open = s.invoices.filter((i) => i.status === "OPEN");
  return (
    <div className="space-y-6">
      {s.readOnly && (
        <Notice tone="danger">
          {t(
            s.state === "cancelled"
              ? "The subscription has ended: records can be looked at and printed, but nothing new can be saved."
              : "The clinic is read-only until the open invoice is paid. Staff can still look up and print records.",
          )}
        </Notice>
      )}
      {s.plan && <Status s={{ ...s, plan: s.plan }} t={t} />}
      <Card title={t("Invoices from HMIS")} description={open.length ? t("{n} to pay", { n: open.length }) : undefined}>
        {s.invoices.length ? (
          <ul className="-my-4 divide-y divide-slate-100 dark:divide-slate-800">
            {s.invoices.map((i) => (
              <Invoice key={i.id} invoice={i} bankDetails={s.bankDetails} online={s.online} t={t} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t("No invoices yet")}>
            {t(s.state === "trial" ? "HMIS sends the first invoice before the free trial ends." : "Invoices from HMIS appear here.")}
          </EmptyState>
        )}
      </Card>
      {(s.support.phone || s.support.email) && (
        <p className="text-sm text-slate-500">
          {t("Questions about the subscription, or a different plan: {contact}", { contact: [s.support.phone, s.support.email].filter(Boolean).join(" · ") })}
        </p>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <>
      <PageTitle title="Subscription" subtitle="your HMIS plan and invoices" actions={<BackToSettings />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Content />
      </Suspense>
    </>
  );
}

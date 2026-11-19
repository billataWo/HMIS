import type { Metadata } from "next";
import { connection } from "next/server";
import { ArrowRight, ChevronRight, NotebookPen, Phone, Printer, ScrollText, Server } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ColumnChart } from "@/components/charts";
import { Badge, Card, EmptyState, Notice, secondaryButtonClass, Skeleton } from "@/components/ui";
import { clinicToday, etb, formatAgo } from "@/lib/format";
import { type ClinicDetail, type ClinicUsage, DEPLOYMENT_LABEL, METHOD_LABEL, type Plan, platformApi } from "@/lib/platform";
import { NoteForm } from "../../../followup-forms";
import { ActivityList } from "../../activity";
import { SectionNav } from "../../section-nav";
import { lateBy, NoteItem } from "../../notes";
import { ClinicActions, DeleteClinicData, DownloadLicence, InvoiceActions, IssueInvoice, PaymentReview, SubscriptionForm } from "../../../forms";
import { change, date, dateTime, INVOICE_STATUS as INVOICE, PAYMENT_STATUS as PAYMENT, StateBadge, tdClass, thClass } from "../../bits";

export const metadata: Metadata = { title: "Clinic" };

/** A clinic server is offline when it has not been heard from for a day. */
const offline = (iso: string | null) => !iso || Date.now() - new Date(iso).getTime() > 86_400_000;

/** Is the clinic using HMIS? Visits a day, sign-ins, and its servers: a quiet clinic is about to leave. */
function Usage({ u, activeStaff }: { u: ClinicUsage; activeStaff: number }) {
  const c = change(u.visits30, u.visitsPrevious30);
  return (
    <Card id="usage" title="Use of HMIS" description="The last 30 days.">
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <ColumnChart title="Visits a day" points={u.days.map((d) => ({ label: d.day, value: d.visits, display: String(d.visits) }))} ariaLabel="Visits each day over the last 30 days" tick={(d) => String(Number(d.slice(8)))} />
        <dl className="grid grid-cols-2 content-start gap-4 text-sm lg:grid-cols-1">
          <div>
            <dt className="text-slate-500">Visits</dt>
            <dd className="text-xl font-semibold tabular-nums">{u.visits30}</dd>
            <dd className="text-xs text-slate-500">
              {c ? (
                <>
                  <span className={c.pct > 0 ? "font-semibold text-emerald-700 dark:text-emerald-400" : c.pct < 0 ? "font-semibold text-red-700 dark:text-red-400" : ""}>{c.text}</span> on the 30 days before
                </>
              ) : (
                "none in the 30 days before"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Staff who signed in</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {u.staffSignedIn30} <span className="text-sm font-normal text-slate-500">of {activeStaff}</span>
            </dd>
            <dd className="text-xs text-slate-500">
              {u.signIns30} sign-in{u.signIns30 === 1 ? "" : "s"} · last {formatAgo(u.lastSignInAt)}
            </dd>
          </div>
        </dl>
      </div>
      {u.servers.length > 0 && (
        <ul className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
          {u.servers.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Server aria-hidden className={`size-4 ${offline(x.lastSeenAt) ? "text-red-600" : "text-emerald-600"}`} />
              <span className="font-medium">{x.name}</span>
              <Badge tone={offline(x.lastSeenAt) ? "danger" : "success"}>{offline(x.lastSeenAt) ? "Not syncing" : "Syncing"}</Badge>
              <span className="text-slate-500">
                last seen {formatAgo(x.lastSeenAt)}
                {x.edgeVersion ? ` · version ${x.edgeVersion}` : ""}
              </span>
              {x.lastError && <span className="w-full text-xs text-red-700 dark:text-red-400">{x.lastError}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Calls, promises to pay and notes: open follow-ups first (soonest first), then the rest, newest first. */
function Notes({ c, today }: { c: ClinicDetail; today: string }) {
  const open = c.notes.filter((n) => n.followUpOn && !n.doneAt).sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!));
  const rest = c.notes.filter((n) => !open.includes(n));
  return (
    <Card id="follow-up" title="Follow-up" description="Calls, promises to pay and notes, for whoever deals with this clinic next.">
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <NoteForm tenantId={c.tenant.id} today={today} />
        <div className="min-w-0">
          {!c.notes.length ? (
            <p className="text-sm text-slate-500">No notes yet. After a call, write down what was agreed: the next person will see it here.</p>
          ) : (
            <>
              {open.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">To follow up</h3>
                  <ul className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
                    {open.map((n) => (
                      <NoteItem key={n.id} note={n} daysLate={lateBy(n.followUpOn, today)} today={today} />
                    ))}
                  </ul>
                </>
              )}
              {rest.length > 0 && (
                <>
                  {open.length > 0 && <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Earlier</h3>}
                  <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                    {rest.map((n) => (
                      <NoteItem key={n.id} note={n} daysLate={0} today={today} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, { plans }] = await Promise.all([platformApi<ClinicDetail>(`/platform/clinics/${id}`), platformApi<{ plans: Plan[] }>("/platform/plans")]);
  const s = c.subscription;
  await connection(); // "today" is the request's, not a prerender's
  const today = clinicToday();
  const phone = c.tenant.phone ?? c.admins.find((a) => a.active)?.phone;
  const dueNotes = c.notes.filter((n) => n.followUpOn && !n.doneAt && clinicToday(new Date(n.followUpOn)) <= today).length;
  const openInvoices = c.invoices.filter((i) => i.status === "OPEN").length;
  const paidOn = (invoiceId: string) => c.payments.filter((p) => p.invoiceId === invoiceId && p.status === "CONFIRMED").reduce((sum, p) => sum + Number(p.amount), 0);
  return (
    <div className="space-y-6">
      <div>
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-sm text-slate-500">
          <Link href="/platform/clinics" className="hover:text-slate-900 hover:underline dark:hover:text-white">
            Clinics
          </Link>
          <ChevronRight aria-hidden className="size-4" />
          <span className="truncate">{c.tenant.name}</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{c.tenant.name}</h1>
            {s && <StateBadge state={s.state} />}
          </div>
          <div className="flex flex-wrap gap-2">
            {phone && (
              <a href={`tel:${phone}`} className={`${secondaryButtonClass} gap-2`}>
                <Phone aria-hidden className="size-4" /> <span className="tabular-nums">{phone}</span>
              </a>
            )}
            <a href="#follow-up" className={`${secondaryButtonClass} gap-2`}>
              <NotebookPen aria-hidden className="size-4" /> Write a note
            </a>
            <Link href={`/platform/statement/${c.tenant.id}`} className={`${secondaryButtonClass} gap-2`}>
              <ScrollText aria-hidden className="size-4" /> Statement
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-500">{[c.tenant.nameAm, c.tenant.address, `with HMIS since ${date(c.tenant.createdAt)}`].filter(Boolean).join(" · ")}</p>
        <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-5 dark:border-slate-800 dark:bg-slate-900">
          {(
            [
              ["Plan", s ? s.plan.name : "Not billed", s ? DEPLOYMENT_LABEL[s.deployment] : null],
              [s?.status === "TRIAL" ? "Trial ends" : "Paid until", s?.endsAt ? date(s.endsAt) : "No end date", s?.daysLeft != null && s.daysLeft >= 0 ? `${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left` : null],
              ["Staff", String(c.counts.staff), null],
              ["Patients", String(c.counts.patients), null],
              ["Visits", String(c.counts.visits), null],
            ] as const
          ).map(([label, value, hint]) => (
            <div key={label} className="border-slate-100 p-4 not-last:border-r dark:border-slate-800">
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="mt-1 text-lg font-semibold text-slate-900 tabular-nums dark:text-white">{value}</dd>
              {hint && <dd className={`text-xs ${label !== "Plan" && s?.daysLeft != null && s.daysLeft <= 7 ? "font-medium text-amber-700 dark:text-amber-300" : "text-slate-500"}`}>{hint}</dd>}
            </div>
          ))}
        </dl>
      </div>

      <SectionNav
        sections={[
          { id: "usage", label: "Use" },
          { id: "follow-up", label: "Follow-up", count: dueNotes },
          { id: "subscription", label: "Subscription" },
          ...(s ? [{ id: "invoices", label: "Invoices", count: openInvoices }] : []),
          ...(c.payments.length ? [{ id: "payments", label: "Payments" }] : []),
          { id: "history", label: "History" },
        ]}
      />

      <Usage u={c.usage} activeStaff={c.counts.staff} />

      <Notes c={c} today={today} />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <Card
          id="subscription"
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
          <Card title="Admins">
            <ul className="space-y-2 text-sm">
              {c.admins.map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{a.fullName}</span>{" "}
                  <a href={`tel:${a.phone}`} className="text-brand-700 tabular-nums hover:underline dark:text-brand-400">
                    {a.phone}
                  </a>
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
        <Card
          id="invoices"
          title="Invoices"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/platform/statement/${c.tenant.id}`} className={`${secondaryButtonClass} gap-2`}>
                <ScrollText aria-hidden className="size-4" /> Statement
              </Link>
              <IssueInvoice tenantId={c.tenant.id} />
            </div>
          }
        >
          {c.invoices.length ? (
            <ul className="-my-4 divide-y divide-slate-100 dark:divide-slate-800">
              {c.invoices.map((i) => (
                <li key={i.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <Link href={`/platform/invoice/${i.id}`} className="inline-flex items-center gap-1.5 font-mono font-medium text-brand-700 hover:underline dark:text-brand-400">
                      <Printer aria-hidden className="size-3.5" />
                      {i.number}
                    </Link>
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
        <Card id="payments" title="Payments" className="overflow-x-auto">
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
                  <td className={tdClass}>{METHOD_LABEL[p.method] ?? p.method}</td>
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

      <Card
        id="history"
        title="History"
        description="What the HMIS team did for this clinic."
        actions={
          c.history.length > 0 && (
            <Link href={`/platform/history?tenantId=${c.tenant.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
              All of it <ArrowRight aria-hidden className="size-4" />
            </Link>
          )
        }
      >
        {c.history.length ? <ActivityList entries={c.history} withDate withClinic={false} /> : <p className="text-sm text-slate-500">Nothing yet.</p>}
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

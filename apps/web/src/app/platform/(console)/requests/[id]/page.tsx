import { ChevronRight, Mail, Phone, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Badge, Card, Notice, Skeleton } from "@/components/ui";
import { type ClinicRequest, DEPLOYMENT_LABEL, type Plan, platformApi, type PlatformSettings } from "@/lib/platform";
import { ApproveForm, RejectRequest } from "../../../forms";
import { dateTime } from "../../bits";

const STATUS = { PENDING: { label: "Waiting for a decision", tone: "warning" }, APPROVED: { label: "Approved", tone: "success" }, REJECTED: { label: "Rejected", tone: "neutral" } } as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900 dark:text-white">{children || <span className="font-normal text-slate-500">Not given</span>}</dd>
    </div>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, { plans }, settings] = await Promise.all([
    platformApi<ClinicRequest>(`/platform/requests/${id}`),
    platformApi<{ plans: Plan[] }>("/platform/plans"),
    platformApi<PlatformSettings>("/platform/settings"),
  ]);
  const plan = plans.find((p) => p.code === r.planCode);
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-sm text-slate-500">
        <Link href="/platform/requests" className="hover:text-slate-900 hover:underline dark:hover:text-white">
          Requests
        </Link>
        <ChevronRight aria-hidden className="size-4" />
        <span className="font-mono">{r.reference}</span>
      </nav>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{r.clinicName}</h1>
        <Badge tone={STATUS[r.status].tone} dot>
          {STATUS[r.status].label}
        </Badge>
        <span className="text-sm text-slate-500">sent {dateTime(r.createdAt)}</span>
        <span className="text-sm text-slate-500">
          {r.termsVersion ? `accepted the terms and privacy policy of ${r.termsVersion}` : "sent before the terms were on the form"}
        </span>
      </div>

      {r.similar && r.similar.length > 0 && (
        <div className="mb-6 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">This may be a clinic that already uses HMIS</p>
            <p className="mt-0.5">
              Same phone or a similar name:{" "}
              {r.similar.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ", "}
                  <Link href={`/platform/clinics/${s.id}`} className="font-medium underline">
                    {s.name}
                  </Link>
                </span>
              ))}
              . Check before approving.
            </p>
          </div>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <div className="space-y-7">
            <Group title="The clinic">
              <Row label="Name">{r.clinicName}</Row>
              <Row label="Name in Amharic">{r.clinicNameAm}</Row>
              <Row label="Type">{r.type.charAt(0) + r.type.slice(1).toLowerCase()}</Row>
              <Row label="Licence number">{r.licenceNumber}</Row>
              <Row label="Where">{[r.address, r.city, r.region].filter(Boolean).join(", ")}</Row>
            </Group>
            <Group title="What they would like">
              <Row label="Plan">{plan ? plan.name : r.planCode ?? "Not sure yet"}</Row>
              <Row label="Runs on">{DEPLOYMENT_LABEL[r.deployment]}</Row>
              <Row label="Staff who will use HMIS">{r.staffCount}</Row>
            </Group>
            {r.message && (
              <section>
                <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Their message</h2>
                <blockquote className="rounded-lg border-l-4 border-brand-600 bg-slate-50 px-4 py-3 text-sm whitespace-pre-line text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {r.message}
                </blockquote>
              </section>
            )}
          </div>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-22">
          <Card title="Who to call">
            <p className="font-medium text-slate-900 dark:text-white">{r.contactName}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`tel:${r.contactPhone}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                <Phone aria-hidden className="size-4" />
                <span className="tabular-nums">{r.contactPhone}</span>
              </a>
              {r.contactEmail && (
                <a
                  href={`mailto:${r.contactEmail}`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
                >
                  <Mail aria-hidden className="size-4" />
                  Email
                </a>
              )}
            </div>
          </Card>

          {r.status === "PENDING" ? (
            <>
              <Card title="Approve" description="After the call: confirm the details below. Approving creates the clinic, its first admin and the free trial.">
                <ApproveForm
                  id={r.id}
                  plans={plans}
                  defaults={{ planCode: r.planCode, deployment: r.deployment, trialDays: settings.trialDays, clinicName: r.clinicName, adminName: r.contactName, adminPhone: r.contactPhone }}
                />
              </Card>
              <RejectRequest id={r.id} />
            </>
          ) : r.status === "APPROVED" ? (
            <Notice tone="success">
              Approved {r.reviewedAt && dateTime(r.reviewedAt)}.{" "}
              {r.tenantId && (
                <Link href={`/platform/clinics/${r.tenantId}`} className="font-medium underline">
                  Open the clinic
                </Link>
              )}
            </Notice>
          ) : (
            <Notice tone="info">
              Rejected {r.reviewedAt && dateTime(r.reviewedAt)}: {r.rejectReason}
            </Notice>
          )}
        </div>
      </div>
    </>
  );
}

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Content params={params} />
    </Suspense>
  );
}

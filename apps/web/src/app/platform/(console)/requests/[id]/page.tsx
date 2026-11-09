import Link from "next/link";
import { Suspense } from "react";
import { Card, Notice, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { type ClinicRequest, DEPLOYMENT_LABEL, type Plan, platformApi, type PlatformSettings } from "@/lib/platform";
import { ApproveForm, RejectRequest } from "../../../forms";
import { dateTime } from "../../bits";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 dark:text-white">{children || "—"}</dd>
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
  return (
    <div className="space-y-6">
      <Card title={r.clinicName} description={`${r.reference} · sent ${dateTime(r.createdAt)}`}>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <Row label="Amharic name">{r.clinicNameAm}</Row>
          <Row label="Type">{r.type.toLowerCase()}</Row>
          <Row label="Licence number">{r.licenceNumber}</Row>
          <Row label="Where">{[r.address, r.city, r.region].filter(Boolean).join(", ")}</Row>
          <Row label="Contact">
            {r.contactName}, {r.contactPhone}
          </Row>
          <Row label="Email">{r.contactEmail}</Row>
          <Row label="Plan asked for">{r.planCode ?? "Not sure"}</Row>
          <Row label="Staff">{r.staffCount}</Row>
          <Row label="Runs on">{DEPLOYMENT_LABEL[r.deployment]}</Row>
        </dl>
        {r.message && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-line text-slate-700 dark:bg-slate-900 dark:text-slate-200">{r.message}</p>}
      </Card>

      {r.similar && r.similar.length > 0 && (
        <Notice tone="warning">
          Possibly already a clinic here:{" "}
          {r.similar.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link href={`/platform/clinics/${s.id}`} className="underline">
                {s.name}
              </Link>
            </span>
          ))}
        </Notice>
      )}

      {r.status === "PENDING" ? (
        <>
          <Card title="Approve" description="Call the clinic first to confirm the details. Approving creates the clinic, its first admin and the free trial.">
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
            <Link href={`/platform/clinics/${r.tenantId}`} className="underline">
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
  );
}

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <PageHeader
        title="Request"
        actions={
          <Link href="/platform/requests" className={secondaryButtonClass}>
            All requests
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}

import { ClipboardPlus, FlaskConical, ShieldCheck, TestTubes, Truck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Flash } from "@/components/flash";
import { LabValue } from "@/components/lab-result";
import { PageTitle } from "@/components/page-title";
import { Badge, buttonClass, EmptyState, secondaryButtonClass, Skeleton } from "@/components/ui";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { api, ApiError, type LabWorkOrder, type QcState } from "@/lib/api";
import { ageText, formatDuration, formatMinutes, formatTime, fullName, minutesBetween } from "@/lib/format";
import { AmendResult, BenchRow, CollectTubes } from "./bench-row";

/** Groups a flat list of orders by visit, keeping the order of first appearance. */
function byVisit(orders: LabWorkOrder[]) {
  const groups = new Map<string, LabWorkOrder[]>();
  for (const o of orders) groups.set(o.visit.id, [...(groups.get(o.visit.id) ?? []), o]);
  return [...groups.values()];
}

/** "took 42 min", red when it missed the target. */
function Took({ minutes, target, t }: { minutes: number; target?: number | null; t: T }) {
  const late = target != null && minutes > target;
  return (
    <span className={late ? "font-medium text-red-700 dark:text-red-400" : ""}>
      {" "}
      · {t("took {time}", { time: formatMinutes(minutes, t) })}
      {late && ` (${t("target {time}", { time: formatMinutes(target, t) })})`}
    </span>
  );
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Addis_Ababa" });

/** One patient's tests on the bench: who, who asked, the samples to take, and each test. */
function VisitGroup({ group, prepayment, labs, qc, short, t }: { group: LabWorkOrder[]; prepayment: boolean; labs: string[]; qc: Record<string, QcState>; short: Record<string, string[]>; t: T }) {
  const { visit, orderedBy, orderedAt } = group[0];
  const age = ageText(visit.patient.dateOfBirth, true, t);
  const urgent = group.some((o) => o.urgent);
  return (
    <section className={`surface p-4 ${urgent ? "border-red-300 ring-1 ring-red-200 dark:border-red-800 dark:ring-red-900" : "dark:border-slate-800"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          {urgent && <Badge tone="danger">{t("Urgent")}</Badge>} <span className="font-medium">{fullName(visit.patient)}</span>
          <span className="text-sm text-slate-500">
            {" "}· {visit.patient.mrn} · {t(visit.patient.sex === "MALE" ? "M" : "F")}
            {age !== null && ` · ${age}`}
            {visit.kind === "LAB" ? "" : ` · ${t("queue #{n}", { n: visit.queueNumber })}`}
          </span>
        </div>
        <span className="text-xs text-slate-500">
          {visit.kind === "LAB"
            ? group[0].requestedBy
              ? t("Lab-only request from {who}", { who: group[0].requestedBy })
              : t("Lab-only request")
            : t("Dr. {name}", { name: orderedBy.fullName })}{" "}
          · {formatTime(orderedAt)} · {t("waiting {time}", { time: formatDuration(orderedAt, undefined, t) })}
          {group.some((o) => o.sampleId) && (
            <>
              {" · "}
              <Link href={`/lab-labels/${visit.id}`} target="_blank" className="text-brand-700 hover:underline dark:text-brand-400">
                {t("Print labels")}
              </Link>
            </>
          )}
        </span>
      </div>
      <CollectTubes orders={group} prepayment={prepayment} />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {group.map((o) => (
          <BenchRow
            key={o.id}
            o={o}
            prepayment={prepayment}
            labs={labs}
            qc={qc[o.labTest.id]}
            reagentShort={short[o.labTest.id]}
            sampleMinutes={o.sampleCollectedAt ? minutesBetween(o.sampleCollectedAt) : null}
            sentSince={o.sentAt ? `${shortDay(o.sentAt)} (${formatDuration(o.sentAt, undefined, t)})` : undefined}
          />
        ))}
      </ul>
    </section>
  );
}

async function Worklist() {
  let data: { prepayment: boolean; open: LabWorkOrder[]; verifiedToday: LabWorkOrder[]; qc: Record<string, QcState>; reagentShort: Record<string, string[]> };
  let labs: string[];
  const t = await getT();
  try {
    [data, labs] = await Promise.all([api<typeof data>("/lab/worklist"), api<string[]>("/lab/reference-labs")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only lab technicians and admins work the lab bench.")}</p>;
    throw e;
  }
  // Samples at reference labs wait apart from the bench, until their results come back.
  const isOut = (o: LabWorkOrder) => o.status === "SAMPLE_COLLECTED" && !!o.sentAt;
  const bench = data.open.filter((o) => !isOut(o));
  const out = data.open.filter(isOut);
  return (
    <div className="space-y-6">
      {bench.length === 0 ? (
        <EmptyState icon={FlaskConical} title={t("No tests waiting")} />
      ) : (
        byVisit(bench).map((group) => <VisitGroup key={group[0].visit.id} group={group} prepayment={data.prepayment} labs={labs} qc={data.qc} short={data.reagentShort} t={t} />)
      )}

      {out.length > 0 && (
        <details open className="space-y-3">
          <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 font-medium">
            <span>
              {t("At reference labs")} <span className="text-slate-500">({out.length})</span>
            </span>
            <Link href="/lab-dispatch" target="_blank" className="text-xs font-normal text-brand-700 hover:underline dark:text-brand-400">
              {t("Today's dispatch list")}
            </Link>
          </summary>
          <div className="mt-3 space-y-4">
            {byVisit(out).map((group) => (
              <VisitGroup key={group[0].visit.id} group={group} prepayment={data.prepayment} labs={labs} qc={data.qc} short={data.reagentShort} t={t} />
            ))}
          </div>
        </details>
      )}

      {data.verifiedToday.length > 0 && (
        <details className="surface p-4 dark:border-slate-800">
          <summary className="cursor-pointer font-medium">
            {t("Verified today")} <span className="text-slate-500">({data.verifiedToday.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.verifiedToday.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {fullName(o.visit.patient)} · {o.labTest.name}: <LabValue o={o} />
                </span>
                <span className="text-xs text-slate-500">
                  {o.amendedAt && <Badge tone="warning">{t("Amended")}</Badge>} {o.urgent && <Badge tone="danger">{t("Urgent")}</Badge>} {o.verifiedAt && formatTime(o.verifiedAt)}
                  {o.verifiedAt && o.sampleCollectedAt && !o.amendedAt && <Took minutes={minutesBetween(o.sampleCollectedAt, o.verifiedAt)} target={o.targetMinutes} t={t} />} ·{" "}
                  <Link href={`/lab-report/${o.visit.id}`} target="_blank" className="text-brand-700 hover:underline dark:text-brand-400">
                    {t("Print")}
                  </Link>{" "}
                  · <AmendResult o={o} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

async function Message({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  return <Flash params={await searchParams} />;
}

async function Actions() {
  const t = await getT();
  return (
    <>
      <Link href="/lab/qc" className={secondaryButtonClass}>
        <ShieldCheck aria-hidden />
        QC
      </Link>
      <Link href="/lab/reagents" className={secondaryButtonClass}>
        <TestTubes aria-hidden />
        {t("Reagents")}
      </Link>
      <Link href="/lab-dispatch" target="_blank" className={secondaryButtonClass}>
        <Truck aria-hidden />
        {t("Dispatch list")}
      </Link>
      <Link href="/lab/request?from=lab" className={buttonClass}>
        <ClipboardPlus aria-hidden />
        {t("Lab-only request")}
      </Link>
    </>
  );
}

export default function LabPage({ searchParams }: PageProps<"/lab">) {
  return (
    <>
      <PageTitle title="Laboratory" subtitle="samples and results" actions={<Actions />} />
      <Suspense fallback={null}>
        <Message searchParams={searchParams as Promise<{ done?: string; error?: string }>} />
      </Suspense>
      <AutoRefresh seconds={20} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Worklist />
      </Suspense>
    </>
  );
}

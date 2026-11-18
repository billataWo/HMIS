import { HeartHandshake, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Badge, EmptyState, linkClass, Notice, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, type FpDueRow, type Me } from "@/lib/api";
import { formatDualDate, fullName } from "@/lib/format";
import { FP_METHODS } from "@/lib/fp";

export const metadata: Metadata = { title: "Family planning" };

const day = (d: string) => formatDualDate(`${d}T12:00:00+03:00`);

/**
 * Family planning clients who need to come back: late for a resupply (two weeks past it) first,
 * then due this week, and implants or IUCDs due out within a month.
 */
async function Due() {
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (!["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"].includes(me.role)) return <Notice tone="info">{t("Family planning follow-up is kept by the nurses and the front desk.")}</Notice>;
  const rows = await api<FpDueRow[]>("/family-planning/due");
  if (!rows.length) {
    return (
      <EmptyState icon={HeartHandshake} title={t("Nobody due or late")}>
        {t("Clients appear here when a resupply is due, or an implant or IUCD is due out.")}
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.patient.id} className={`surface space-y-1 p-4 text-sm ${r.late ? "border-red-300 dark:border-red-900" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p>
              <Link href={`/patients/${r.patient.id}#family-planning`} className="font-semibold hover:underline">
                {fullName(r.patient)}
              </Link>{" "}
              <span className="text-slate-500">
                · {r.patient.mrn} · {t(FP_METHODS[r.method]?.label ?? r.method)}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {r.removal ? (
                <Badge tone="info">{t("Due out {date}", { date: day(r.nextDueOn) })}</Badge>
              ) : r.late ? (
                <Badge tone="danger">{t("{n} days late", { n: r.daysLate })}</Badge>
              ) : (
                <Badge tone="warning">{t("Resupply due {date}", { date: day(r.nextDueOn) })}</Badge>
              )}
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
            {r.patient.phone ? (
              <a href={`tel:${r.patient.phone}`} className={`${linkClass} inline-flex items-center gap-1`}>
                <Phone aria-hidden className="size-3.5" />
                {r.patient.phone}
              </a>
            ) : (
              <span>{t("no phone")}</span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function FamilyPlanningPage() {
  return (
    <>
      <PageTitle title="Family planning" subtitle="clients due for a resupply or a removal" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Due />
      </Suspense>
    </>
  );
}

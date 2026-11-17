import { Phone, Syringe } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Badge, EmptyState, linkClass, Notice, pillClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, type DueChild, type Me } from "@/lib/api";
import { ageText, formatAgo, formatDualDate, fullName } from "@/lib/format";
import { DOSE_STATUS, EPI_FOLLOW_UPS } from "@/lib/immunization";
import { EpiFollowUpForm } from "./epi-follow-up-form";

export const metadata: Metadata = { title: "Immunization" };

type Search = { show?: string };

const day = (d: string) => formatDualDate(`${d}T12:00:00+03:00`);

/**
 * Children under 5 in the clinic's immunization care with a vaccine due this week or late:
 * defaulters (late by more than two weeks) first, the latest first, with the calls made.
 */
async function Due({ searchParams }: { searchParams: Promise<Search> }) {
  const show = (await searchParams).show === "due" ? "due" : "late";
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (!["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"].includes(me.role)) return <Notice tone="info">{t("Immunization follow-up is kept by the nurses and the front desk.")}</Notice>;
  const all = await api<DueChild[]>("/immunizations/due");
  const rows = all.filter((r) => (show === "late" ? r.defaulter : !r.defaulter));
  const late = all.filter((r) => r.defaulter).length;
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label={t("Which children")}>
        <Link href="/immunizations" aria-current={show === "late" ? "page" : undefined} className={pillClass(show === "late")}>
          {t("Late (defaulters)")} {late > 0 && `· ${late}`}
        </Link>
        <Link href="/immunizations?show=due" aria-current={show === "due" ? "page" : undefined} className={pillClass(show === "due")}>
          {t("Due this week")} · {all.length - late}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={Syringe} title={t(show === "late" ? "No child is late for a vaccine" : "No vaccine due this week")}>
          {t("Children appear here once they have a dose recorded at this clinic.")}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const f = r.lastFollowUp && EPI_FOLLOW_UPS.find((o) => o.value === r.lastFollowUp!.outcome);
            return (
              <li key={r.patient.id} className={`surface space-y-3 p-4 text-sm ${r.defaulter ? "border-red-300 dark:border-red-900" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p>
                      <Link href={`/patients/${r.patient.id}#immunization`} className="font-semibold hover:underline">
                        {fullName(r.patient)}
                      </Link>{" "}
                      <span className="text-slate-500">
                        · {r.patient.mrn} · {ageText(r.patient.dateOfBirth, false, t)}
                      </span>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {r.patient.phone ? (
                        <a href={`tel:${r.patient.phone}`} className={`${linkClass} inline-flex items-center gap-1`}>
                          <Phone aria-hidden className="size-3.5" />
                          {r.patient.phone}
                        </a>
                      ) : (
                        <span>{t("no phone")}</span>
                      )}
                      {r.defaulter && <span className="font-medium text-red-700 dark:text-red-400">{t("{n} days late", { n: r.daysLate })}</span>}
                    </p>
                    <p className="flex flex-wrap gap-1.5">
                      {r.doses.map((d) => (
                        <Badge key={d.label} tone={DOSE_STATUS[d.status].tone}>
                          {d.label} · {t("due {date}", { date: day(d.dueOn) })}
                        </Badge>
                      ))}
                    </p>
                    {r.lastFollowUp && (
                      <p className="text-xs text-slate-500">
                        {t("Last call: {outcome}", { outcome: t(f?.label ?? r.lastFollowUp.outcome) })}
                        {r.lastFollowUp.note && ` · ${r.lastFollowUp.note}`} · {r.lastFollowUp.by}, {formatAgo(r.lastFollowUp.at, t)}
                      </p>
                    )}
                  </div>
                </div>
                {r.defaulter && <EpiFollowUpForm patientId={r.patient.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ImmunizationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <>
      <PageTitle title="Immunization" subtitle="children due or late for a vaccine" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Due searchParams={searchParams} />
      </Suspense>
    </>
  );
}

import { Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type ReferralRow } from "@/lib/api";
import { formatDualDate, formatTime, fullName } from "@/lib/format";
import { REFERRAL_STATUS, URGENCY_LABEL } from "@/lib/referrals";
import { FollowUpForm } from "./follow-up-form";

export const metadata: Metadata = { title: "Referrals" };

type Search = { view?: string };

const TABS = [
  { view: "open", label: "Open" },
  { view: "all", label: "All (90 days)" },
] as const;

/**
 * Referrals out, followed until the patient has been seen and the other facility's feedback is
 * back. Open ones are oldest first; an urgent one not heard of after a day (a week for routine) is
 * overdue.
 */
async function Referrals({ searchParams }: { searchParams: Promise<Search> }) {
  const view = (await searchParams).view === "all" ? "all" : "open";
  let rows: ReferralRow[];
  try {
    rows = await api<ReferralRow[]>(`/referrals?view=${view}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Referrals are kept by doctors, nurses and admins.</p>;
    throw e;
  }
  const overdue = rows.filter((r) => r.overdue).length;

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Which referrals">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={`/referrals?view=${t.view}`}
            aria-current={t.view === view ? "page" : undefined}
            className={`rounded-full px-3 py-1 font-medium ${t.view === view ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"}`}
          >
            {t.label}
          </Link>
        ))}
        {view === "open" && overdue > 0 && <Badge tone="danger">{overdue} overdue</Badge>}
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={Send} title={view === "open" ? "No referrals waiting" : "No referrals in the last 90 days"}>
          Referral letters issued from a consultation appear here until the patient has been seen.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const s = REFERRAL_STATUS[r.status];
            const open = r.status === "SENT" || r.status === "ARRIVED";
            return (
              <li key={r.id} className={`surface space-y-3 p-4 text-sm ${r.overdue ? "border-red-300 dark:border-red-900" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <Link href={`/visits/${r.visit.id}`} className="hover:underline">
                        {fullName(r.visit.patient)}
                      </Link>{" "}
                      <span className="font-normal text-slate-500">{r.visit.patient.mrn}</span>
                    </p>
                    <p>
                      To <strong>{r.to}</strong> · {r.reason}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDualDate(r.createdAt)} · {r.ageDays === 0 ? "today" : `${r.ageDays} day${r.ageDays === 1 ? "" : "s"} ago`}
                      {r.issuedBy && ` · Dr. ${r.issuedBy}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.urgency !== "ROUTINE" && <Badge tone="danger">{URGENCY_LABEL[r.urgency]}</Badge>}
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {r.overdue && <Badge tone="danger">Overdue</Badge>}
                  </div>
                </div>
                {r.followUps.length > 0 && (
                  <ol className="space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                    {r.followUps.map((f) => (
                      <li key={f.id}>
                        <span className="font-medium">{REFERRAL_STATUS[f.status].label}</span>
                        {f.note && <span> · {f.note}</span>}
                        <span className="text-xs text-slate-500">
                          {" "}
                          · {f.createdBy ?? "Unknown"}, {formatDualDate(f.createdAt)} {formatTime(f.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {(open || r.status === "DID_NOT_GO") && <FollowUpForm documentId={r.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ReferralsPage({ searchParams }: PageProps<"/referrals">) {
  return (
    <>
      <PageHeader title="Referrals" subtitle="ሪፈራሎች · followed until the patient is seen and feedback is back" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Referrals searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

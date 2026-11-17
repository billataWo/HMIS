import { Baby, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, linkClass, Notice, PageHeader, Skeleton } from "@/components/ui";
import { api, type AncDueRow, type Me } from "@/lib/api";
import { formatDualDate, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Antenatal care" };

const day = (d: string) => formatDualDate(`${d}T12:00:00+03:00`);

/**
 * Women followed in antenatal care who need attention: late for their contact (a week past it)
 * first, then due now or this week, and those whose due date is within two weeks.
 */
async function Due() {
  const me = await api<Me>("/auth/me");
  if (!["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"].includes(me.role)) return <Notice tone="info">Antenatal follow-up is kept by the nurses and the front desk.</Notice>;
  const rows = await api<AncDueRow[]>("/anc/due");
  if (!rows.length) return <EmptyState icon={Baby} title="Nobody due or late">Women registered for antenatal care appear here when a contact is due.</EmptyState>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.pregnancyId} className={`surface space-y-1 p-4 text-sm ${r.late ? "border-red-300 dark:border-red-900" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p>
              <Link href={`/patients/${r.patient.id}#anc`} className="font-semibold hover:underline">
                {fullName(r.patient)}
              </Link>{" "}
              <span className="text-slate-500">
                · {r.patient.mrn} · {r.gestation.weeks} weeks · {r.contacts} contact{r.contacts === 1 ? "" : "s"}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {r.late && <Badge tone="danger">{r.daysLate} days late</Badge>}
              {!r.late && <Badge tone="warning">Contact due {day(r.nextContactOn)}</Badge>}
              {r.deliverySoon && <Badge tone="info">Due to deliver {day(r.edd)}</Badge>}
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
            {r.patient.phone ? (
              <a href={`tel:${r.patient.phone}`} className={`${linkClass} inline-flex items-center gap-1`}>
                <Phone aria-hidden className="size-3.5" />
                {r.patient.phone}
              </a>
            ) : (
              <span>no phone</span>
            )}
            <span>Next contact {day(r.nextContactOn)}</span>
            <span>Due date {day(r.edd)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function AncPage() {
  return (
    <>
      <PageHeader title="Antenatal care" subtitle="የቅድመ ወሊድ ክትትል · women due or late for a contact" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Due />
      </Suspense>
    </>
  );
}

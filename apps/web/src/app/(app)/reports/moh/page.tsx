import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type MohReport } from "@/lib/api";
import { formatDualDate, shiftDay, toEthiopian } from "@/lib/format";

type Search = { y?: string; m?: string };

const AGE_LABEL: Record<string, string> = { "<1": "Under 1", "1-4": "1–4", "5-14": "5–14", "15-29": "15–29", "30-64": "30–64", "65+": "65 and over", unknown: "Age not recorded" };

function step(y: number, m: number, by: number) {
  const n = m + by;
  return n < 1 ? { y: y - 1, m: 13 } : n > 13 ? { y: y + 1, m: 1 } : { y, m: n };
}

async function Report({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const qs = params.y && params.m ? `?ecYear=${Number(params.y)}&ecMonth=${Number(params.m)}` : "";
  let r: MohReport;
  try {
    r = await api<MohReport>(`/reports/moh-monthly${qs}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only clinic admins can see reports.</p>;
    throw e;
  }
  const { ecYear: y, ecMonth: m } = r.period;
  const prev = step(y, m, -1);
  const next = step(y, m, 1);
  const now = toEthiopian(new Date());
  const isCurrent = now.year === y && now.month === m;
  const lastDay = shiftDay(r.period.endDay, -1);
  const cell = "border border-slate-300 px-2 py-1 dark:border-slate-700";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/reports/moh?y=${prev.y}&m=${prev.m}`} aria-label="Previous month" className={`${secondaryButtonClass} px-2.5`}>
          <ChevronLeft aria-hidden />
        </Link>
        <span className="px-2 font-medium">
          {r.period.labelAm} · {r.period.label}
        </span>
        {!isCurrent && (
          <Link href={`/reports/moh?y=${next.y}&m=${next.m}`} aria-label="Next month" className={`${secondaryButtonClass} px-2.5`}>
            <ChevronRight aria-hidden />
          </Link>
        )}
        <a href={`/reports/moh/csv?y=${y}&m=${m}`} className={`${secondaryButtonClass} ml-auto`}>
          Download CSV
        </a>
      </div>

      <header className="text-sm">
        <p className="text-lg font-semibold">
          {r.facility.name}
          {r.facility.nameAm && <span className="font-normal text-slate-500"> · {r.facility.nameAm}</span>}
        </p>
        <p className="text-slate-500">
          Monthly OPD report · {r.period.labelAm} ({formatDualDate(`${r.period.startDay}T12:00:00+03:00`)} – {formatDualDate(`${lastDay}T12:00:00+03:00`)})
          {isCurrent && " · month in progress"}
        </p>
      </header>

      <section>
        <h2 className="mb-2 font-medium">1. Outpatient visits by age and sex</h2>
        <table className="w-full max-w-xl border-collapse text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className={`${cell} text-left`}>Age group</th>
              <th className={`${cell} text-right`}>Male</th>
              <th className={`${cell} text-right`}>Female</th>
              <th className={`${cell} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {r.opd.byAge
              .filter((a) => a.ageGroup !== "unknown" || a.male + a.female > 0)
              .map((a) => (
                <tr key={a.ageGroup}>
                  <td className={cell}>{AGE_LABEL[a.ageGroup] ?? a.ageGroup}</td>
                  <td className={`${cell} text-right tabular-nums`}>{a.male}</td>
                  <td className={`${cell} text-right tabular-nums`}>{a.female}</td>
                  <td className={`${cell} text-right tabular-nums`}>{a.male + a.female}</td>
                </tr>
              ))}
            <tr className="font-semibold">
              <td className={cell}>Total</td>
              <td className={`${cell} text-right tabular-nums`}>{r.opd.male}</td>
              <td className={`${cell} text-right tabular-nums`}>{r.opd.female}</td>
              <td className={`${cell} text-right tabular-nums`}>{r.opd.total}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-sm">
          New visits <strong>{r.opd.newVisits}</strong> · repeat visits <strong>{r.opd.repeatVisits}</strong>
          {" "}· referrals in <strong>{r.opd.referralsIn ?? 0}</strong> · out <strong>{r.opd.referralsOut}</strong>
          {r.opd.withoutDiagnosis > 0 && <span className="text-amber-700 dark:text-amber-400"> · {r.opd.withoutDiagnosis} visits have no diagnosis recorded</span>}
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">2. Top 10 causes of OPD morbidity (primary diagnosis)</h2>
        {r.morbidity.length === 0 ? (
          <p className="text-sm text-slate-500">No diagnoses recorded this month.</p>
        ) : (
          <table className="w-full max-w-3xl border-collapse text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className={`${cell} text-right`}>#</th>
                <th className={`${cell} text-left`}>ICD-11</th>
                <th className={`${cell} text-left`}>Diagnosis</th>
                <th className={`${cell} text-right`}>Male</th>
                <th className={`${cell} text-right`}>Female</th>
                <th className={`${cell} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {r.morbidity.map((x, i) => (
                <tr key={x.code}>
                  <td className={`${cell} text-right`}>{i + 1}</td>
                  <td className={`${cell} font-mono text-xs`}>{x.code}</td>
                  <td className={cell}>{x.label}</td>
                  <td className={`${cell} text-right tabular-nums`}>{x.male}</td>
                  <td className={`${cell} text-right tabular-nums`}>{x.female}</td>
                  <td className={`${cell} text-right tabular-nums`}>{x.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">3. Malaria testing</h2>
        <p className="text-sm">
          Tested <strong>{r.malaria.tested}</strong> · positive <strong>{r.malaria.positive}</strong>
          {r.malaria.tested > 0 && ` (${Math.round((r.malaria.positive / r.malaria.tested) * 100)}% positivity)`}
        </p>
        {r.malaria.byResult.length > 0 && <p className="text-sm text-slate-500">{r.malaria.byResult.map((x) => `${x.result}: ${x.count}`).join(" · ")}</p>}
      </section>

      <p className="max-w-3xl text-xs text-slate-500">
        Counts come from completed and ongoing visits, primary diagnoses and verified malaria tests. Check the indicators and age bands against your Regional Health Bureau&apos;s
        current reporting form before submitting.
      </p>
      <div className="max-w-xs print:hidden">
        <PrintButton />
      </div>
    </div>
  );
}

export default function MohPage({ searchParams }: PageProps<"/reports/moh">) {
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Monthly MoH report"
          subtitle="ወርሃዊ ሪፖርት · by Ethiopian calendar month"
          actions={
            <Link href="/reports" className={secondaryButtonClass}>
              Dashboard
            </Link>
          }
        />
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Report searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

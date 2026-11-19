// i18n: english-only — the report itself is the government form, submitted in English; the screen
// controls around it (title, week/month arrows, alert, CSV and Print buttons) follow the language.
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { LangBoundary } from "@/components/lang-boundary";
import { PageTitle } from "@/components/page-title";
import { secondaryButtonClass, Skeleton } from "@/components/ui";
import { formatAddress } from "@/lib/address";
import { api, ApiError, type IdsrReport } from "@/lib/api";
import { ageText, formatDualDate, fullName, shiftDay } from "@/lib/format";
import { getT } from "@/lib/lang";
import { NoAccess } from "@/components/status-page";

export const metadata: Metadata = { title: "Weekly IDSR report" };

type Search = { day?: string };

const noon = (day: string) => `${day}T12:00:00+03:00`;

/**
 * The weekly IDSR report for the woreda health office: every priority disease (zero included) by
 * age, the malaria tests, and the immediately reportable cases with whether each was reported.
 */
async function Report({ searchParams }: { searchParams: Promise<Search> }) {
  const { day } = await searchParams;
  const t = await getT();
  let r: IdsrReport;
  try {
    r = await api<IdsrReport>(`/reports/idsr-weekly${day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `?day=${day}` : ""}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only clinic admins can see reports.")}</NoAccess>;
    throw e;
  }
  const lastDay = shiftDay(r.week.end, -1);
  const cell = "border border-slate-300 px-2 py-1 dark:border-slate-700";
  const num = `${cell} text-right tabular-nums`;
  const unknownAge = r.diseases.some((d) => d.unknownAge > 0);
  const group = (immediate: boolean) => r.diseases.filter((d) => d.immediate === immediate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/reports/idsr?day=${shiftDay(r.week.start, -7)}`} aria-label={t("Previous week")} className={`${secondaryButtonClass} px-2.5`}>
          <ChevronLeft aria-hidden />
        </Link>
        <span className="px-2 font-medium">{t("Epi week {week}, {year}", { week: r.week.week, year: r.week.year })}</span>
        {!r.week.inProgress && (
          <Link href={`/reports/idsr?day=${r.week.end}`} aria-label={t("Next week")} className={`${secondaryButtonClass} px-2.5`}>
            <ChevronRight aria-hidden />
          </Link>
        )}
      </div>

      {r.unreported.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 print:hidden dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">
            {t(
              r.unreported.length === 1
                ? "{n} immediately reportable case in the last {days} days not recorded as reported"
                : "{n} immediately reportable cases in the last {days} days not recorded as reported",
              { n: r.unreported.length, days: r.unreportedDays },
            )}
          </p>
          <ul className="mt-1 space-y-0.5">
            {r.unreported.map((c) => (
              <li key={`${c.visitId}:${c.disease}`}>
                <Link href={`/visits/${c.visitId}#notifiable`} className="underline-offset-4 hover:underline">
                  {c.label}: {fullName(c.patient)} ({c.patient.mrn}), {formatDualDate(c.checkedInAt)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <header className="text-sm">
        <p className="text-lg font-semibold">
          {r.facility.name}
          {r.facility.nameAm && <span className="font-normal text-slate-500"> · {r.facility.nameAm}</span>}
        </p>
        <p className="text-slate-500">
          Weekly IDSR report · epi week {r.week.week}/{r.week.year} · {formatDualDate(noon(r.week.start))} – {formatDualDate(noon(lastDay))}
          {r.week.inProgress && " · week in progress"}
        </p>
      </header>

      <section>
        <h2 className="mb-2 font-medium">1. Cases of priority diseases</h2>
        <div className="overflow-x-auto">
          <table className="w-full max-w-3xl border-collapse text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className={`${cell} text-left`}>Disease</th>
                <th className={`${cell} text-right`}>Under 5</th>
                <th className={`${cell} text-right`}>5 and over</th>
                {unknownAge && <th className={`${cell} text-right`}>Age not recorded</th>}
                <th className={`${cell} text-right`}>Total</th>
              </tr>
            </thead>
            {([true, false] as const).map((immediate) => (
              <tbody key={String(immediate)}>
                <tr className="bg-slate-50/60 dark:bg-slate-900/60">
                  <th colSpan={unknownAge ? 5 : 4} className={`${cell} text-left text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-300`}>
                    {immediate ? "Immediately reportable" : "Weekly reportable"}
                  </th>
                </tr>
                {group(immediate).map((d) => (
                  <tr key={d.key} className={d.total > 0 ? "font-semibold" : undefined}>
                    <td className={cell}>
                      {d.label} <span lang="am" className="font-normal text-slate-500">· {d.labelAm}</span>
                    </td>
                    <td className={num}>{d.under5}</td>
                    <td className={num}>{d.over5}</td>
                    {unknownAge && <td className={num}>{d.unknownAge}</td>}
                    <td className={num}>{d.total}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="mt-2 max-w-3xl text-xs text-slate-500">
          A patient counts once per disease per week, from every diagnosis of their consultations. Deaths are not recorded in this system: add any by hand.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">2. Malaria tests (released this week)</h2>
        <p className="text-sm">
          Tested <strong>{r.malaria.tested}</strong> · positive <strong>{r.malaria.positive}</strong>
          {r.malaria.tested > 0 && ` (${Math.round((r.malaria.positive / r.malaria.tested) * 100)}% positivity)`}
        </p>
        {r.malaria.positive > 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            P. falciparum {r.malaria.falciparum} · P. vivax {r.malaria.vivax} · mixed {r.malaria.mixed}
            {r.malaria.notStated > 0 && ` · species not stated ${r.malaria.notStated}`}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">3. Immediately reportable cases this week</h2>
        {r.immediateCases.length === 0 ? (
          <p className="text-sm text-slate-500">None.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full max-w-4xl border-collapse text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className={`${cell} text-left`}>Seen</th>
                  <th className={`${cell} text-left`}>Disease</th>
                  <th className={`${cell} text-left`}>Patient</th>
                  <th className={`${cell} text-left`}>Address</th>
                  <th className={`${cell} text-left`}>Reported</th>
                </tr>
              </thead>
              <tbody>
                {r.immediateCases.map((c) => {
                  const age = ageText(c.patient.dateOfBirth, true);
                  return (
                    <tr key={`${c.visitId}:${c.disease}`}>
                      <td className={`${cell} whitespace-nowrap`}>{formatDualDate(c.checkedInAt)}</td>
                      <td className={cell}>{c.label}</td>
                      <td className={cell}>
                        <Link href={`/visits/${c.visitId}`} className="hover:underline">
                          {fullName(c.patient)}
                        </Link>{" "}
                        <span className="text-xs text-slate-500">
                          {c.patient.mrn} · {c.patient.sex === "MALE" ? "M" : "F"}
                          {age !== null && `, ${age}`}
                        </span>
                      </td>
                      <td className={cell}>{formatAddress(c.patient) ?? "—"}</td>
                      <td className={cell}>
                        {c.notification ? (
                          <>
                            {formatDualDate(c.notification.reportedAt)} to {c.notification.reportedTo}
                            {c.notification.reportedBy && <span className="text-xs text-slate-500"> ({c.notification.reportedBy})</span>}
                          </>
                        ) : (
                          <strong className="text-red-700 dark:text-red-400">Not reported</strong>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="max-w-3xl text-xs text-slate-500">
        Epidemiological weeks run Monday to Sunday. Check the disease list against EPHI&apos;s current IDSR form before submitting.
      </p>
      <div className="max-w-xs print:hidden">
        <LangBoundary>
          <PrintButton />
        </LangBoundary>
      </div>
    </div>
  );
}

async function BackToDashboard() {
  const t = await getT();
  return (
    <Link href="/reports" className={secondaryButtonClass}>
      {t("Dashboard")}
    </Link>
  );
}

export default function IdsrPage({ searchParams }: PageProps<"/reports/idsr">) {
  return (
    <>
      <div className="print:hidden">
        <PageTitle title="Weekly IDSR report" subtitle="for the woreda health office" actions={<BackToDashboard />} />
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Report searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

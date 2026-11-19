import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { LeveyJennings } from "@/components/levey-jennings";
import { PageTitle } from "@/components/page-title";
import { Badge, type BadgeTone, EmptyState, secondaryButtonClass, Skeleton } from "@/components/ui";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { api, ApiError, type LabQcControl, type LabQcPage, type QcState } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";
import { ActionForm, AddControl, RetireControl, RunForm } from "./qc-forms";
import { NoAccess } from "@/components/status-page";

const STATE: Record<QcState["status"], [BadgeTone, string]> = {
  OK: ["success", "QC passed today"],
  WARN: ["warning", "QC warning today"],
  DUE: ["warning", "QC due today"],
  FAIL: ["danger", "QC failed: patient results held"],
};
const RUN: Record<string, [BadgeTone, string]> = { PASS: ["success", "Pass"], WARN: ["warning", "Warning"], FAIL: ["danger", "Fail"] };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Addis_Ababa" });

function Control({ c, unit, options, today, t }: { c: LabQcControl; unit: string | null; options: string[]; today: string; t: T }) {
  const last = c.results[0];
  const expired = !!c.expiresAt && new Date(c.expiresAt).getTime() < Date.parse(`${today}T00:00:00+03:00`);
  const sd = (z: string | null) => (z === null ? "" : `${Number(z) >= 0 ? "+" : ""}${Number(z).toFixed(1)} SD`);
  return (
    <div className={`space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800 ${c.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-medium">{c.name}</span>
          <span className="text-xs text-slate-500">
            {c.expected ? ` · ${t("must give {value}", { value: c.expected })}` : ` · ${Number(c.mean)} ± ${Number(c.sd)}${unit ? ` ${unit}` : ""}`}
            {c.lot && ` · ${t("lot {lot}", { lot: c.lot })}`}
          </span>
          {c.expiresAt && (
            <span className={`text-xs ${expired ? "font-medium text-red-700 dark:text-red-400" : "text-slate-500"}`}>
              {" "}
              · {t(expired ? "expired {date}" : "expires {date}", { date: day(c.expiresAt) })}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs text-slate-500">
          {last && (
            <span>
              {t("Last run {when}", { when: day(last.createdAt) === today ? t("today {time}", { time: formatTime(last.createdAt) }) : formatDualDate(last.createdAt) })}: {last.value}{" "}
              <Badge tone={RUN[last.status][0]}>
                {t(RUN[last.status][1])}
                {last.rule && ` · ${last.rule}`}
              </Badge>
            </span>
          )}
          <RetireControl c={c} />
        </span>
      </div>
      {last?.status === "FAIL" && (
        <div className="space-y-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/50 dark:text-red-100">
          <p>
            <span className="font-semibold">{t("Failed ({rule}).", { rule: last.rule ?? "" })}</span>{" "}
            {t("Patient results for this test are held. Find and fix the cause, write down what was done, then run the control again.")}
          </p>
          {last.action ? <p className="text-xs">{t("Done: {action}", { action: last.action })}</p> : <ActionForm runId={last.id} />}
        </div>
      )}
      {c.active && !expired && <RunForm c={c} unit={unit} options={options} />}
      {!c.expected && <LeveyJennings runs={c.results} unit={unit} t={t} />}
      {c.results.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-brand-700 dark:text-brand-400">{t("Runs ({n})", { n: c.results.length })}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">{t("When")}</th>
                  <th className="py-1 pr-2 font-medium">{t("Result")}</th>
                  {!c.expected && <th className="py-1 pr-2 font-medium">SD</th>}
                  <th className="py-1 pr-2 font-medium">{t("Verdict")}</th>
                  <th className="py-1 font-medium">{t("Note / action")}</th>
                </tr>
              </thead>
              <tbody>
                {c.results.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {day(r.createdAt)} {formatTime(r.createdAt)}
                    </td>
                    <td className="py-1 pr-2">{r.value}</td>
                    {!c.expected && <td className="py-1 pr-2 tabular-nums">{sd(r.z)}</td>}
                    <td className="py-1 pr-2">
                      {t(RUN[r.status][1])}
                      {r.rule && ` (${r.rule})`}
                    </td>
                    <td className="py-1">{[r.note, r.action && t("Done: {action}", { action: r.action })].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

async function Qc() {
  let data: LabQcPage;
  const t = await getT();
  try {
    data = await api<LabQcPage>("/lab/qc");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only lab technicians and admins keep the QC log.")}</NoAccess>;
    throw e;
  }
  return (
    <div className="space-y-6">
      {data.tests.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t("No controls yet")}>
          {t("Add a control for each test you run here: a measured level with its mean and SD, or a kit's positive and negative controls.")}
        </EmptyState>
      ) : (
        data.tests.map((lt) => (
          <section key={lt.id} id={`qc-${lt.id}`} className="surface scroll-mt-6 space-y-3 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{lt.name}</h2>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                {lt.state.detail && lt.state.status !== "OK" && <span>{t(lt.state.detail)}</span>}
                <Badge tone={STATE[lt.state.status][0]} dot>
                  {t(STATE[lt.state.status][1])}
                </Badge>
              </span>
            </div>
            {lt.controls.map((c) => (
              <Control key={c.id} c={c} unit={lt.unit} options={lt.resultOptions} today={data.today} t={t} />
            ))}
          </section>
        ))
      )}
      <section className="surface space-y-3 p-4 dark:border-slate-800">
        <h2 className="font-semibold">{t("Add a control")}</h2>
        <p className="text-sm text-slate-500">
          {t("Runs are judged by the Westgard rules: beyond 2 SD warns; beyond 3 SD, two runs beyond 2 SD, two levels 4 SD apart, four beyond 1 SD or ten on one side of the mean fail. A failure holds the test's patient results until the control passes again.")}
        </p>
        <AddControl tests={data.allTests} />
      </section>
    </div>
  );
}

async function BackToBench() {
  const t = await getT();
  return (
    <Link href="/lab" className={secondaryButtonClass}>
      <ArrowLeft aria-hidden />
      {t("Lab bench")}
    </Link>
  );
}

export default function QcPage() {
  return (
    <>
      <PageTitle title="Quality control" subtitle="controls, runs and the Levey-Jennings chart" actions={<BackToBench />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Qc />
      </Suspense>
    </>
  );
}

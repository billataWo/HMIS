import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { LeveyJennings } from "@/components/levey-jennings";
import { Badge, type BadgeTone, EmptyState, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type LabQcControl, type LabQcPage, type QcState } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";
import { ActionForm, AddControl, RetireControl, RunForm } from "./qc-forms";

const STATE: Record<QcState["status"], [BadgeTone, string]> = {
  OK: ["success", "QC passed today"],
  WARN: ["warning", "QC warning today"],
  DUE: ["warning", "QC due today"],
  FAIL: ["danger", "QC failed: patient results held"],
};
const RUN: Record<string, [BadgeTone, string]> = { PASS: ["success", "Pass"], WARN: ["warning", "Warning"], FAIL: ["danger", "Fail"] };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Addis_Ababa" });

function Control({ c, unit, options, today }: { c: LabQcControl; unit: string | null; options: string[]; today: string }) {
  const last = c.results[0];
  const expired = !!c.expiresAt && new Date(c.expiresAt).getTime() < Date.parse(`${today}T00:00:00+03:00`);
  const sd = (z: string | null) => (z === null ? "" : `${Number(z) >= 0 ? "+" : ""}${Number(z).toFixed(1)} SD`);
  return (
    <div className={`space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800 ${c.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-medium">{c.name}</span>
          <span className="text-xs text-slate-500">
            {c.expected ? ` · must give ${c.expected}` : ` · ${Number(c.mean)} ± ${Number(c.sd)}${unit ? ` ${unit}` : ""}`}
            {c.lot && ` · lot ${c.lot}`}
          </span>
          {c.expiresAt && (
            <span className={`text-xs ${expired ? "font-medium text-red-700 dark:text-red-400" : "text-slate-500"}`}>
              {" "}
              · {expired ? "expired" : "expires"} {day(c.expiresAt)}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs text-slate-500">
          {last && (
            <span>
              Last run {day(last.createdAt) === today ? `today ${formatTime(last.createdAt)}` : formatDualDate(last.createdAt)}: {last.value}{" "}
              <Badge tone={RUN[last.status][0]}>
                {RUN[last.status][1]}
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
            <span className="font-semibold">Failed ({last.rule}).</span> Patient results for this test are held. Find and fix the cause, write down what was
            done, then run the control again.
          </p>
          {last.action ? <p className="text-xs">Done: {last.action}</p> : <ActionForm runId={last.id} />}
        </div>
      )}
      {c.active && !expired && <RunForm c={c} unit={unit} options={options} />}
      {!c.expected && <LeveyJennings runs={c.results} unit={unit} />}
      {c.results.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-brand-700 dark:text-brand-400">Runs ({c.results.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">When</th>
                  <th className="py-1 pr-2 font-medium">Result</th>
                  {!c.expected && <th className="py-1 pr-2 font-medium">SD</th>}
                  <th className="py-1 pr-2 font-medium">Verdict</th>
                  <th className="py-1 font-medium">Note / action</th>
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
                      {RUN[r.status][1]}
                      {r.rule && ` (${r.rule})`}
                    </td>
                    <td className="py-1">{[r.note, r.action && `Done: ${r.action}`].filter(Boolean).join(" · ")}</td>
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
  try {
    data = await api<LabQcPage>("/lab/qc");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only lab technicians and admins keep the QC log.</p>;
    throw e;
  }
  return (
    <div className="space-y-6">
      {data.tests.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No controls yet">
          Add a control for each test you run here: a measured level with its mean and SD, or a kit&apos;s positive and negative controls.
        </EmptyState>
      ) : (
        data.tests.map((t) => (
          <section key={t.id} id={`qc-${t.id}`} className="surface scroll-mt-6 space-y-3 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{t.name}</h2>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                {t.state.detail && t.state.status !== "OK" && <span>{t.state.detail}</span>}
                <Badge tone={STATE[t.state.status][0]} dot>
                  {STATE[t.state.status][1]}
                </Badge>
              </span>
            </div>
            {t.controls.map((c) => (
              <Control key={c.id} c={c} unit={t.unit} options={t.resultOptions} today={data.today} />
            ))}
          </section>
        ))
      )}
      <section className="surface space-y-3 p-4 dark:border-slate-800">
        <h2 className="font-semibold">Add a control</h2>
        <p className="text-sm text-slate-500">
          Runs are judged by the Westgard rules: beyond 2 SD warns; beyond 3 SD, two runs beyond 2 SD, two levels 4 SD apart, four beyond 1 SD or ten on one
          side of the mean fail. A failure holds the test&apos;s patient results until the control passes again.
        </p>
        <AddControl tests={data.allTests} />
      </section>
    </div>
  );
}

export default function QcPage() {
  return (
    <>
      <PageHeader
        title="Quality control"
        subtitle="ጥራት ቁጥጥር · controls, runs and the Levey-Jennings chart"
        actions={
          <Link href="/lab" className={secondaryButtonClass}>
            <ArrowLeft aria-hidden />
            Lab bench
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Qc />
      </Suspense>
    </>
  );
}

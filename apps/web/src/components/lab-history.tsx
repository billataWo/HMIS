"use client";

import Link from "next/link";
import { useT } from "@/components/lang-provider";
import { LabValue } from "@/components/lab-result";
import type { LabHistoryOrder } from "@/lib/api";
import { formatDualDate } from "@/lib/format";

/** Released results grouped by test, each test's newest first: the latest in full, earlier ones beside it. */
export function byTest(history: LabHistoryOrder[]) {
  const groups = new Map<string, LabHistoryOrder[]>();
  for (const o of history) groups.set(o.labTest.id, [...(groups.get(o.labTest.id) ?? []), o]);
  return [...groups.values()];
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "Africa/Addis_Ababa" });

/** "11.2 L (3 Oct 26) · 10.4 L (1 Sep 26)": earlier single-value results of the same test. */
export function Earlier({ orders }: { orders: LabHistoryOrder[] }) {
  const t = useT();
  if (!orders.length) return null;
  return (
    <span className="block text-xs text-slate-500">
      {t("Earlier:")}{" "}
      {orders.slice(0, 4).map((o, i) => (
        <span key={o.id}>
          {i > 0 && " · "}
          <span className={o.resultFlag && o.resultFlag !== "N" ? "font-medium text-red-700 dark:text-red-400" : ""}>
            {o.labTest.components?.length ? t("panel") : o.resultValue}
            {o.resultFlag && o.resultFlag !== "N" ? ` ${o.resultFlag}` : ""}
          </span>{" "}
          ({shortDate(o.verifiedAt ?? o.orderedAt)})
        </span>
      ))}
    </span>
  );
}

/** The patient record's lab section: every test ever released, with its trend. */
export function LabHistory({ history }: { history: LabHistoryOrder[] }) {
  const t = useT();
  return (
    <section id="lab-results" className="surface scroll-mt-6 p-4 lg:col-span-2 dark:border-slate-800">
      <h2 className="mb-2 font-medium">{t("Lab results")}</h2>
      {history.length === 0 ? (
        <p className="text-sm text-slate-500">{t("No released results yet.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {byTest(history).map(([latest, ...earlier]) => (
            <li key={latest.labTest.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{latest.labTest.name}</span>: <LabValue o={latest} />
                  {latest.rangeText && <span className="text-xs text-slate-500"> ({t("ref {range}", { range: latest.rangeText })})</span>}
                </span>
                <span className="text-xs text-slate-500">
                  {formatDualDate(latest.verifiedAt ?? latest.orderedAt)}
                  {latest.visit.kind === "LAB" && ` · ${t("lab-only")}`} ·{" "}
                  <Link href={`/lab-report/${latest.visit.id}`} target="_blank" className="text-brand-700 hover:underline dark:text-brand-400">
                    {t("Report")}
                  </Link>
                </span>
              </div>
              <Earlier orders={earlier} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelLabOrder, labAlertSeen, markLabUrgent, orderLabTests } from "@/app/actions";
import { LAB_STATUS, LabValue, rangeText } from "@/components/lab-result";
import { Alert, buttonClass } from "@/components/ui";
import { Earlier } from "@/components/lab-history";
import type { LabHistoryOrder, LabOrder, LabTest } from "@/lib/api";
import { ConfirmCancel } from "@/components/confirm-cancel";
import { useT } from "@/components/lang-provider";
import { etb } from "@/lib/format";

export function LabPanel({
  visitId,
  orders,
  tests,
  editable,
  history = [],
}: {
  visitId: string;
  orders: LabOrder[];
  tests: LabTest[];
  editable: boolean;
  /** The patient's released results from other visits, newest first. */
  history?: LabHistoryOrder[];
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const t = useT();
  const open = new Set(orders.filter((o) => o.status !== "CANCELLED" && o.status !== "VERIFIED").map((o) => o.labTest.id));
  const available = tests.filter((lt) => !open.has(lt.id));
  const total = tests.filter((lt) => picked.includes(lt.id)).reduce((s, lt) => s + Number(lt.price), 0);
  const anyVerified = orders.some((o) => o.status === "VERIFIED");

  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = await orderLabTests(visitId, picked, urgent);
      if (res.error) setError(res.error);
      else {
        setPicked([]);
        setUrgent(false);
      }
    });
  const makeUrgent = (id: string) =>
    start(async () => {
      setError(undefined);
      const res = await markLabUrgent(id);
      if (res.error) setError(res.error);
    });

  return (
    <section id="lab-tests" className="surface scroll-mt-6 space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900 dark:text-white">{t("Lab tests")}</h2>
        {anyVerified && (
          <Link href={`/lab-report/${visitId}`} target="_blank" className="text-xs text-brand-700 hover:underline dark:text-brand-400">
            {t("Print results")}
          </Link>
        )}
      </div>

      {orders.length === 0 && <p className="text-sm text-slate-500">{t("No tests ordered.")}</p>}
      {orders.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
          {orders.map((o) => (
            <li key={o.id} className={`flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 ${o.status === "CANCELLED" ? "opacity-50" : ""}`}>
              <span>
                {o.urgent && o.status !== "CANCELLED" && (
                  <span className="mr-1.5 rounded bg-red-700 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase dark:bg-red-600">{t("Urgent")}</span>
                )}
                <span className={`font-medium ${o.status === "CANCELLED" ? "line-through" : ""}`}>{o.labTest.name}</span>
                {o.status === "VERIFIED" ? (
                  <>
                    {": "}
                    <LabValue o={o} />
                    {(o.rangeText ?? rangeText(o.labTest)) && <span className="text-xs text-slate-500"> ({t("ref {range}", { range: o.rangeText ?? rangeText(o.labTest) ?? "" })})</span>}
                    {o.resultNote && <span className="block text-xs text-slate-500">{o.resultNote}</span>}
                    {o.sentTo && <span className="block text-xs text-slate-500">{t("Done at {place}", { place: o.sentTo })}</span>}
                    <Earlier orders={history.filter((h) => h.labTest.id === o.labTest.id)} />
                    {o.amendedAt && o.amendments && o.amendments.length > 0 && (
                      <span className="block text-xs text-amber-800 dark:text-amber-300">
                        {t("Amended: was {value}", { value: o.amendments.at(-1)!.previousValue })} · {o.amendments.at(-1)!.reason}
                      </span>
                    )}
                    {o.critical && o.criticalNotified && <span className="block text-xs text-slate-500">{t("Critical result phoned to {name}", { name: o.criticalNotified })}</span>}
                  </>
                ) : o.status === "ORDERED" && o.rejectReason ? (
                  <span className="text-xs font-medium text-amber-800 dark:text-amber-300"> · {t("New sample needed ({reason})", { reason: t(o.rejectReason) })}</span>
                ) : (
                  <span className="text-xs text-slate-500"> · {o.status === "SAMPLE_COLLECTED" && o.sentTo ? t("Sent to {place}", { place: o.sentTo }) : t(LAB_STATUS[o.status])}</span>
                )}
                {o.alert && !o.alertSeenAt && (
                  <span
                    role="alert"
                    className={`mt-1 flex flex-wrap items-center gap-2 rounded-md px-2 py-1 text-xs font-medium ${
                      o.alert === "CRITICAL" ? "bg-red-700 text-white dark:bg-red-600" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                    }`}
                  >
                    {t(o.alert === "CRITICAL" ? "Critical result: act on it now" : "This result was corrected after release")}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => start(() => labAlertSeen(o.id))}
                      className="rounded bg-white/90 px-2 py-0.5 text-slate-900 hover:bg-white"
                    >
                      {t("Mark as seen")}
                    </button>
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3">
                {editable && !o.urgent && (o.status === "ORDERED" || o.status === "SAMPLE_COLLECTED" || o.status === "RESULTED") && (
                  <button type="button" disabled={pending} onClick={() => makeUrgent(o.id)} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
                    {t("Make urgent")}
                  </button>
                )}
                {editable && o.status === "ORDERED" && (
                  <ConfirmCancel disabled={pending} onConfirm={() => start(() => cancelLabOrder(o.id))} question={t("Cancel this test?")} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && available.length > 0 && (
        <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-700">
          <div className="grid gap-1 sm:grid-cols-2">
            {available.map((lt) => (
              <label key={lt.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(lt.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, lt.id] : p.filter((x) => x !== lt.id)))}
                />
                {lt.name}
                <span className="text-xs text-slate-500">{t("{amount} ETB", { amount: Number(lt.price).toFixed(0) })}</span>
              </label>
            ))}
          </div>
          {error && <Alert>{t(error)}</Alert>}
          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={pending} onClick={submit} className={buttonClass}>
                {pending ? t("Ordering…") : `${t(picked.length === 1 ? "Order {n} test" : "Order {n} tests", { n: picked.length })} · ${etb(total, t)}`}
              </button>
              <label className="flex items-center gap-2 text-sm" title={t("The lab does these first, with a shorter target time")}>
                <input type="checkbox" name="urgent" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
                <span className={urgent ? "font-medium text-red-700 dark:text-red-400" : ""}>{t("Urgent (needed now)")}</span>
              </label>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

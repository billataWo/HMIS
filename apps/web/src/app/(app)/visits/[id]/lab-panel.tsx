"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelLabOrder, orderLabTests } from "@/app/actions";
import { LAB_STATUS, LabValue, rangeText } from "@/components/lab-result";
import { Alert, buttonClass } from "@/components/ui";
import type { LabOrder, LabTest } from "@/lib/api";
import { ConfirmCancel } from "@/components/confirm-cancel";

export function LabPanel({ visitId, orders, tests, editable }: { visitId: string; orders: LabOrder[]; tests: LabTest[]; editable: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const open = new Set(orders.filter((o) => o.status !== "CANCELLED" && o.status !== "VERIFIED").map((o) => o.labTest.id));
  const available = tests.filter((t) => !open.has(t.id));
  const total = tests.filter((t) => picked.includes(t.id)).reduce((s, t) => s + Number(t.price), 0);
  const anyVerified = orders.some((o) => o.status === "VERIFIED");

  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = await orderLabTests(visitId, picked);
      if (res.error) setError(res.error);
      else setPicked([]);
    });

  return (
    <section id="lab-tests" className="surface scroll-mt-6 space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900 dark:text-white">Lab tests</h2>
        {anyVerified && (
          <Link href={`/lab-report/${visitId}`} target="_blank" className="text-xs text-brand-700 hover:underline dark:text-brand-400">
            Print results
          </Link>
        )}
      </div>

      {orders.length === 0 && <p className="text-sm text-slate-500">No tests ordered.</p>}
      {orders.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
          {orders.map((o) => (
            <li key={o.id} className={`flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 ${o.status === "CANCELLED" ? "opacity-50" : ""}`}>
              <span>
                <span className={`font-medium ${o.status === "CANCELLED" ? "line-through" : ""}`}>{o.labTest.name}</span>
                {o.status === "VERIFIED" ? (
                  <>
                    {": "}
                    <LabValue o={o} />
                    {rangeText(o.labTest) && <span className="text-xs text-slate-500"> (ref {rangeText(o.labTest)})</span>}
                    {o.resultNote && <span className="block text-xs text-slate-500">{o.resultNote}</span>}
                  </>
                ) : (
                  <span className="text-xs text-slate-500"> · {LAB_STATUS[o.status]}</span>
                )}
              </span>
              {editable && o.status === "ORDERED" && (
                <ConfirmCancel disabled={pending} onConfirm={() => start(() => cancelLabOrder(o.id))} question="Cancel this test?" />
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && available.length > 0 && (
        <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-700">
          <div className="grid gap-1 sm:grid-cols-2">
            {available.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(t.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))}
                />
                {t.name}
                <span className="text-xs text-slate-500">{Number(t.price).toFixed(0)} ETB</span>
              </label>
            ))}
          </div>
          {error && <Alert>{error}</Alert>}
          {picked.length > 0 && (
            <button type="button" disabled={pending} onClick={submit} className={buttonClass}>
              {pending ? "Ordering…" : `Order ${picked.length} ${picked.length === 1 ? "test" : "tests"} · ${total.toFixed(2)} ETB`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

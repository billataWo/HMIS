"use client";

import { useState } from "react";
import { Badge, buttonClass, EmptyState, inputClass, secondaryButtonClass } from "@/components/ui";
import type { LabWorkOrder } from "@/lib/api";
import { collectSample, enterResult, verifyResult } from "@/lib/offline/actions";
import { PatientLine, type TabProps, useBusy } from "./shared";

export function Lab({ view, userId }: TabProps) {
  const open = view.lab.filter((o) => o.status !== "VERIFIED" && o.status !== "CANCELLED");
  const verified = view.lab.filter((o) => o.status === "VERIFIED");
  return (
    <div className="space-y-4">
      {open.map((o) => (
        <Order key={o.id} order={o} userId={userId} prepayment={view.snap.prepayment} />
      ))}
      {!open.length && <EmptyState title="No open tests on this PC" />}
      {verified.length > 0 && <p className="text-sm text-slate-500">{verified.length} verified on this PC today.</p>}
    </div>
  );
}

function Order({ order, userId, prepayment }: { order: LabWorkOrder; userId: string; prepayment: boolean }) {
  const [busy, run] = useBusy();
  const [sampleId, setSampleId] = useState("");
  const [value, setValue] = useState("");
  const panel = Boolean(order.labTest.components?.length);
  const unpaid = prepayment && order.paid === false;
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white">{order.labTest.name}</p>
          <PatientLine p={order.visit.patient} />
        </div>
        <Badge tone={order.status === "ORDERED" ? "neutral" : order.status === "SAMPLE_COLLECTED" ? "info" : "warning"}>
          {order.status === "ORDERED" ? "Sample to take" : order.status === "SAMPLE_COLLECTED" ? "Result to enter" : "To verify"}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {order.status === "ORDERED" &&
          (unpaid ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">Not paid yet (as far as this PC knows): send the patient to the cashier.</p>
          ) : (
            <>
              <input value={sampleId} onChange={(e) => setSampleId(e.target.value)} placeholder="Sample label (optional)" aria-label="Sample label" className={`${inputClass} w-56`} />
              <button disabled={busy} onClick={() => run(() => collectSample(userId, order, sampleId.trim() || undefined))} className={buttonClass}>
                Sample taken
              </button>
            </>
          ))}
        {order.status === "SAMPLE_COLLECTED" &&
          (panel ? (
            <p className="text-sm text-slate-500">This is a panel test: enter its results when the connection is back.</p>
          ) : (
            <>
              {order.labTest.resultOptions.length ? (
                <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Result" className={`${inputClass} w-56`}>
                  <option value="">Result…</option>
                  {order.labTest.resultOptions.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Result" placeholder={order.labTest.unit ? `Value in ${order.labTest.unit}` : "Result"} className={`${inputClass} w-56`} />
              )}
              <button disabled={busy || !value.trim()} onClick={() => run(() => enterResult(userId, order, value.trim()))} className={buttonClass}>
                Save result
              </button>
            </>
          ))}
        {order.status === "RESULTED" && (
          <>
            <span className="text-sm">
              Result: <span className="font-medium">{order.resultValue}</span> {order.labTest.unit}
            </span>
            <button disabled={busy} onClick={() => run(() => verifyResult(userId, order))} className={secondaryButtonClass}>
              Verify
            </button>
          </>
        )}
      </div>
    </section>
  );
}

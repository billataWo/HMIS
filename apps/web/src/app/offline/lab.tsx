"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { Badge, buttonClass, EmptyState, inputClass, secondaryButtonClass } from "@/components/ui";
import type { LabWorkOrder } from "@/lib/api";
import { collectSample, enterResult, type OfflineResult, rejectSample, verifyResult } from "@/lib/offline/actions";
import { checkResult, isCritical, worstFlag } from "@/lib/offline/ranges";
import { PatientLine, type TabProps, useBusy } from "./shared";

/** Why a sample can't be used (the API's list, as in the lab's reject form). */
const REJECT_REASONS: [string, string][] = [
  ["HAEMOLYSED", "Haemolysed"],
  ["CLOTTED", "Clotted"],
  ["INSUFFICIENT", "Too little sample"],
  ["WRONG_CONTAINER", "Wrong tube or container"],
  ["LABEL", "Unlabelled or wrongly labelled"],
  ["CONTAMINATED", "Contaminated"],
  ["DELAYED", "Too old when it reached the lab"],
  ["OTHER", "Other (say what)"],
];
const FLAG_TONE: Record<string, string> = { HH: "text-red-700 dark:text-red-300", LL: "text-red-700 dark:text-red-300", H: "text-amber-700 dark:text-amber-300", L: "text-amber-700 dark:text-amber-300" };

export function Lab({ view, userId }: TabProps) {
  // Urgent and emergency tests first, as on the bench.
  const open = view.lab
    .filter((o) => o.status !== "VERIFIED" && o.status !== "CANCELLED")
    .sort((a, b) => Number(!!b.urgent || !!b.emergency) - Number(!!a.urgent || !!a.emergency) || a.orderedAt.localeCompare(b.orderedAt));
  const verified = view.lab.filter((o) => o.status === "VERIFIED");
  const t = useT();
  return (
    <div className="space-y-4">
      {open.map((o) => (
        <Order key={o.id} order={o} userId={userId} prepayment={view.snap.prepayment} />
      ))}
      {!open.length && <EmptyState title={t("No open tests on this PC")} />}
      {verified.length > 0 && <p className="text-sm text-slate-500">{t("{n} verified on this PC today.", { n: verified.length })}</p>}
    </div>
  );
}

function Order({ order, userId, prepayment }: { order: LabWorkOrder; userId: string; prepayment: boolean }) {
  const [busy, run] = useBusy();
  const t = useT();
  const [sampleId, setSampleId] = useState("");
  const [rejecting, setRejecting] = useState(false);
  // Emergencies (triaged red) are sampled before payment, as on the server.
  const unpaid = prepayment && order.paid === false && !order.emergency;
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-white">
            {order.labTest.name}
            {order.urgent && <Badge tone="danger">{t("Urgent")}</Badge>}
            {order.emergency && <Badge tone="danger">{t("Emergency")}</Badge>}
          </p>
          <PatientLine p={order.visit.patient} />
        </div>
        <Badge tone={order.status === "ORDERED" ? "neutral" : order.status === "SAMPLE_COLLECTED" ? "info" : "warning"}>
          {t(order.status === "ORDERED" ? "Sample to take" : order.status === "SAMPLE_COLLECTED" ? "Result to enter" : "To verify")}
        </Badge>
      </div>
      {order.status === "ORDERED" && order.rejectReason && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{t("The last sample was rejected ({reason}): take a new one.", { reason: t(order.rejectReason) })}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {order.status === "ORDERED" &&
          (unpaid ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{t("Not paid yet (as far as this PC knows): send the patient to the cashier.")}</p>
          ) : (
            <>
              <input value={sampleId} onChange={(e) => setSampleId(e.target.value)} placeholder={t("Sample label (optional)")} aria-label={t("Sample label")} className={`${inputClass} w-56`} />
              <button disabled={busy} onClick={() => run(() => collectSample(userId, order, sampleId.trim() || undefined))} className={buttonClass}>
                {t("Sample taken")}
              </button>
            </>
          ))}
        {order.status === "SAMPLE_COLLECTED" && <ResultForm order={order} busy={busy} onSave={(r) => run(() => enterResult(userId, order, r))} />}
        {order.status === "RESULTED" && <Verify order={order} busy={busy} onVerify={(notified) => run(() => verifyResult(userId, order, notified))} />}
      </div>
      {(order.status === "SAMPLE_COLLECTED" || order.status === "RESULTED") &&
        (rejecting ? (
          <RejectForm busy={busy} onCancel={() => setRejecting(false)} onReject={(reason, label, note) => run(() => rejectSample(userId, order, reason, label, note))} />
        ) : (
          <button onClick={() => setRejecting(true)} className="mt-3 text-xs text-slate-500 hover:text-slate-800 hover:underline dark:hover:text-slate-200">
            {t("Reject sample")}
          </button>
        ))}
    </section>
  );
}

/** One input per panel component (blank = not run), a choice of answers, or a value; with a flag as typed. */
function ResultForm({ order, busy, onSave }: { order: LabWorkOrder; busy: boolean; onSave: (r: OfflineResult) => void }) {
  const t = useT();
  const test = order.labTest;
  const components = test.components ?? [];
  const patient = order.visit.patient;
  const at = order.sampleCollectedAt ? new Date(order.sampleCollectedAt) : new Date();
  const [value, setValue] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const panel = components.map((c) => ({ c, value: (values[c.id] ?? "").trim(), ...checkResult(c, values[c.id] ?? "", patient, at) }));
  const single = checkResult(test, value, patient, at);
  const errors = components.length ? panel.filter((p) => p.error) : single.error ? [single] : [];
  const entered = components.length ? panel.some((p) => p.value) : value.trim() !== "";
  const result = (): OfflineResult => {
    if (components.length) {
      const done = panel.filter((p) => p.value);
      const flag = worstFlag(done.map((p) => p.flag));
      return {
        values: done.map((p) => ({ componentId: p.c.id, value: p.value, flag: p.flag, rangeText: p.rangeText })),
        summary: done.map((p) => `${p.c.name} ${p.value}${p.flag && p.flag !== "N" ? ` ${p.flag}` : ""}`).join("; "),
        flag,
        critical: done.some((p) => isCritical(p.flag)),
        note: note.trim() || undefined,
      };
    }
    return { value: value.trim(), summary: value.trim(), flag: single.flag, rangeText: single.rangeText, critical: isCritical(single.flag), note: note.trim() || undefined };
  };
  const flagText = (flag: string | null, range: string | null) =>
    flag && flag !== "N" ? (
      <span className={`text-xs font-medium ${FLAG_TONE[flag] ?? ""}`}>
        {flag}
        {isCritical(flag) ? ` · ${t("Critical")}` : ""}
        {range ? ` (${range})` : ""}
      </span>
    ) : range ? (
      <span className="text-xs text-slate-500">{range}</span>
    ) : null;

  return (
    <div className="w-full space-y-3">
      {components.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {panel.map(({ c, flag, rangeText, error }) => (
            <label key={c.id} className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-500">
                {c.name}
                {c.unit ? ` (${c.unit})` : ""}
              </span>
              {c.resultOptions.length ? (
                <select value={values[c.id] ?? ""} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} className={inputClass}>
                  <option value="">{t("Not run")}</option>
                  {c.resultOptions.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <input inputMode="decimal" value={values[c.id] ?? ""} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} className={inputClass} aria-invalid={error ? true : undefined} />
              )}
              {error ? <span className="block text-xs text-red-700 dark:text-red-300">{t("A number")}</span> : flagText(flag, rangeText)}
            </label>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {test.resultOptions.length ? (
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("Result")} className={`${inputClass} w-56`}>
              <option value="">{t("Result…")}</option>
              {test.resultOptions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          ) : (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={t("Result")}
              placeholder={test.unit ? t("Value in {unit}", { unit: test.unit }) : t("Result")}
              className={`${inputClass} w-56`}
            />
          )}
          {single.error ? <span className="text-xs text-red-700 dark:text-red-300">{t("A number")}</span> : flagText(single.flag, single.rangeText)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Comment (optional)")} aria-label={t("Comment")} className={`${inputClass} min-w-48 flex-1`} />
        <button disabled={busy || !entered || errors.length > 0} onClick={() => onSave(result())} className={buttonClass}>
          {t("Save result")}
        </button>
      </div>
    </div>
  );
}

/** Releases the result; a critical one first records who was told (the server refuses it otherwise). */
function Verify({ order, busy, onVerify }: { order: LabWorkOrder; busy: boolean; onVerify: (notified?: string) => void }) {
  const t = useT();
  const [notified, setNotified] = useState("");
  return (
    <div className="w-full space-y-2">
      <p className="text-sm">
        {t.rich("Result: {value}", { value: <span className={`font-medium ${order.resultFlag ? (FLAG_TONE[order.resultFlag] ?? "") : ""}`}>{order.resultValue}</span> })}{" "}
        {order.values?.length ? "" : order.labTest.unit}
      </p>
      {order.critical ? (
        <div className="space-y-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
          <p className="flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-200">
            <TriangleAlert aria-hidden className="size-4 shrink-0" /> {t("This is a critical result: phone the doctor, then record who was told")}
          </p>
          <div className="flex flex-wrap gap-2">
            <input value={notified} onChange={(e) => setNotified(e.target.value)} placeholder={t("Who was told, and how (e.g. Dr. Dawit, by phone)")} aria-label={t("Who was told of the critical result")} className={`${inputClass} min-w-56 flex-1`} />
            <button disabled={busy || notified.trim().length < 2} onClick={() => onVerify(notified.trim())} className={secondaryButtonClass}>
              {t("Verify")}
            </button>
          </div>
        </div>
      ) : (
        <button disabled={busy} onClick={() => onVerify()} className={secondaryButtonClass}>
          {t("Verify")}
        </button>
      )}
    </div>
  );
}

function RejectForm({ busy, onCancel, onReject }: { busy: boolean; onCancel: () => void; onReject: (reason: string, label: string, note?: string) => void }) {
  const t = useT();
  const [reason, setReason] = useState("HAEMOLYSED");
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Why the sample can't be used")} className={`${inputClass} w-64`}>
        {REJECT_REASONS.map(([v, label]) => (
          <option key={v} value={v}>
            {t(label)}
          </option>
        ))}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(reason === "OTHER" ? "What was wrong" : "Note (optional)")} aria-label={t("Note")} className={`${inputClass} min-w-48 flex-1`} />
      <button disabled={busy || (reason === "OTHER" && !note.trim())} onClick={() => onReject(reason, reason === "OTHER" ? "Other" : (REJECT_REASONS.find(([v]) => v === reason)?.[1] ?? reason), note.trim() || undefined)} className={secondaryButtonClass}>
        {t("Reject: take a new sample")}
      </button>
      <button onClick={onCancel} className="text-sm text-slate-500 hover:underline">
        {t("Cancel")}
      </button>
    </div>
  );
}

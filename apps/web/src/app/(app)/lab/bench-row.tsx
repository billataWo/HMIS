"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { cancelLabOnlyTest, labStep, markLabUrgent, type FormState } from "@/app/actions";
import { ConfirmCancel } from "@/components/confirm-cancel";
import { CANCEL_REASONS } from "@/lib/cancel-reasons";
import { isCritical, LAB_STATUS, LabValue, rangeText } from "@/components/lab-result";
import { useT } from "@/components/lang-provider";
import { Alert, Badge, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import Link from "next/link";
import type { LabOrder, LabWorkOrder, QcState } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { specimenLabel, specimenShort, SPECIMENS } from "@/lib/specimens";

const small = "px-3 py-1 text-xs";

/** Why a sample can't be used (the API's list; shown in the reject form). */
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

/**
 * The inputs for a result: one per panel component (blank = not run), a choice of answers, a
 * number with its unit and default range, or free text; plus a comment. Used to enter, correct and
 * amend results.
 */
function ResultFields({ o, defaults, restore }: { o: LabOrder; defaults?: boolean; restore?: Record<string, string> }) {
  const lt = o.labTest;
  const t = useT();
  const range = rangeText(lt);
  const numeric = !lt.resultOptions.length && range !== null;
  // What was typed (after a refused save), else the current result when correcting it.
  const keep = (v: string | null | undefined, name: string) => restore?.[name] ?? (defaults ? (v ?? "") : "");
  return (
    <>
      {lt.components?.length ? (
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lt.components.map((c) => {
            const current = keep(o.values?.find((v) => v.componentId === c.id)?.value, `c_${c.id}`);
            const ref = rangeText(c);
            return (
              <label key={c.id} className="block text-sm">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  {ref && <span className="text-xs text-slate-500">{ref}</span>}
                </span>
                {c.resultOptions.length ? (
                  <select name={`c_${c.id}`} defaultValue={current} className={`${inputClass} mt-1`}>
                    <option value="">—</option>
                    {c.resultOptions.map((opt) => (
                      <option key={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input name={`c_${c.id}`} inputMode={ref ? "decimal" : "text"} defaultValue={current} className={`${inputClass} mt-1`} />
                )}
              </label>
            );
          })}
        </div>
      ) : lt.resultOptions.length ? (
        <select name="value" required defaultValue={keep(o.resultValue, "value")} aria-label={t("Result")} className={`${inputClass} w-48`}>
          <option value="" disabled>
            {t("Choose result")}
          </option>
          {lt.resultOptions.map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      ) : numeric ? (
        <label className="flex items-center gap-1 text-sm">
          <input name="value" required inputMode="decimal" defaultValue={keep(o.resultValue, "value")} aria-label={t("Result")} className={`${inputClass} w-28`} />
          <span className="text-xs text-slate-500">
            {lt.unit} ({t("ref {range}; by sex and age where set", { range: range ?? "" })})
          </span>
        </label>
      ) : (
        <textarea name="value" required rows={2} defaultValue={keep(o.resultValue, "value")} aria-label={t("Result")} className={`${inputClass} min-w-64 flex-1`} />
      )}
      <input name="note" placeholder={t("Comment (optional)")} defaultValue={keep(o.resultNote, "note")} aria-label={t("Comment")} className={`${inputClass} w-56`} />
    </>
  );
}

/** The sample can't be used: record why; the order goes back to "sample needed". */
function RejectSample({ o }: { o: LabOrder }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("HAEMOLYSED");
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
        {t("Sample not usable? Reject it")}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm dark:border-red-900/60 dark:bg-red-950/30">
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="step" value="reject" />
      {state.error && (
        <div className="w-full">
          <Alert>{t(state.error)}</Alert>
        </div>
      )}
      <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Why the sample can't be used")} className={`${inputClass} w-auto`}>
        {REJECT_REASONS.map(([v, l]) => (
          <option key={v} value={v}>
            {t(l)}
          </option>
        ))}
      </select>
      <input name="note" required={reason === "OTHER"} placeholder={t(reason === "OTHER" ? "What was wrong (required)" : "Note (optional)")} aria-label={t("Note")} className={`${inputClass} w-56`} />
      <button disabled={pending} className={`${buttonClass} bg-red-700 hover:bg-red-800 ${small}`}>
        {pending ? t("Saving…") : t("Reject sample")}
      </button>
      <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} ${small}`}>
        {t("Keep it")}
      </button>
      <p className="w-full text-xs text-slate-500">{t("The test goes back to “sample needed”; the patient gives a new sample without paying again.")}</p>
    </form>
  );
}

/** "Critical result: phone the doctor" with where to write who was told. */
function CriticalCall({ required }: { required: boolean }) {
  const t = useT();
  return (
    <div role="alert" className="w-full space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden className="size-4" />
        {t("Critical result: phone the doctor now, before releasing it.")}
      </p>
      <input
        name="notified"
        required={required}
        minLength={3}
        placeholder={t("Who was told, and how (e.g. Dr. Dawit, by phone)")}
        aria-label={t("Who was told of the critical result")}
        className={`${inputClass} w-full`}
      />
    </div>
  );
}

/** A tube-cap dot and the specimen's short name: "● EDTA · purple". */
export function SpecimenTag({ code }: { code: string }) {
  const t = useT();
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-500" title={specimenLabel(code, t) ?? undefined}>
      <span aria-hidden className={`inline-block size-2.5 rounded-full ${SPECIMENS[code]?.cap ?? "bg-slate-300"}`} />
      {specimenShort(code, t)}
    </span>
  );
}

/** One sample to take: its tube and the tests it is for, all given the same number. */
function Tube({ orders }: { orders: LabWorkOrder[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const code = orders[0].labTest.specimen;
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="step" value="collect" />
      <input type="hidden" name="orderId" value={orders[0].id} />
      {orders.map((o) => (
        <input key={o.id} type="hidden" name="orderIds" value={o.id} />
      ))}
      <span>
        <span aria-hidden className={`mr-1.5 inline-block size-3 rounded-full align-[-1px] ${code ? (SPECIMENS[code]?.cap ?? "bg-slate-300") : "bg-slate-300"}`} />
        <span className="font-medium">{specimenLabel(code, t) ?? t("Sample")}</span>
        <span className="text-slate-500"> {t("for {tests}", { tests: orders.map((o) => o.labTest.name).join(", ") })}</span>
      </span>
      <input name="sampleId" placeholder={t("Sample ID (optional)")} aria-label={t("Sample ID")} className={`${inputClass} w-44`} />
      <button disabled={pending} className={`${buttonClass} ${small}`}>
        {t("Sample collected")}
      </button>
      {state.error && (
        <div className="w-full">
          <Alert>{t(state.error)}</Alert>
        </div>
      )}
    </form>
  );
}

/**
 * The samples to take from this patient now: paid tests grouped by tube (tests on the same
 * specimen share one); a test with no specimen set gets a sample of its own.
 */
export function CollectTubes({ orders, prepayment }: { orders: LabWorkOrder[]; prepayment: boolean }) {
  const ready = orders.filter((o) => o.status === "ORDERED" && !(prepayment && !o.paid && !o.emergency));
  const t = useT();
  if (!ready.length) return null;
  const tubes = new Map<string, LabWorkOrder[]>();
  for (const o of ready) {
    const key = o.labTest.specimen ?? `own:${o.id}`;
    tubes.set(key, [...(tubes.get(key) ?? []), o]);
  }
  return (
    <div className="mt-3 space-y-2 rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-700">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {tubes.size === 1 ? t("Sample to take") : t("{n} samples to take", { n: tubes.size })}
      </p>
      {[...tubes.values()].map((tube) => (
        <Tube key={tube[0].id} orders={tube} />
      ))}
    </div>
  );
}

/**
 * The turnaround clock, from the sample: "12 of 60 min", or "Overdue 15 min" once past the target.
 * Before the sample there is no clock (the patient may still be at the cashier).
 */
function Clock({ minutes, target }: { minutes: number; target: number }) {
  const t = useT();
  if (minutes > target) return <Badge tone="danger">{t("Overdue {time}", { time: formatMinutes(minutes - target, t) })}</Badge>;
  return (
    <span className={minutes >= target * 0.75 ? "font-medium text-amber-700 dark:text-amber-400" : ""} title={t("Time since the sample, of the target")}>
      {t("{done} of {target}", { done: formatMinutes(minutes, t), target: formatMinutes(target, t) })}
    </span>
  );
}

/**
 * Sends the sample to a reference lab: which lab (the test's usual one is filled in; labs used
 * before are suggested) and its number there, if they give one.
 */
function SendOut({ o, labs, open: startOpen }: { o: LabWorkOrder; labs: string[]; open: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const [open, setOpen] = useState(startOpen);
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-brand-700 hover:underline">
        {t("Can't do it here? Send it out")}
      </button>
    );
  }
  const list = `labs-${o.id}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm dark:bg-sky-950/40">
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="step" value="send" />
      <span className="font-medium">{t("Send to")}</span>
      <input
        name="to"
        required
        minLength={2}
        list={list}
        defaultValue={state.values?.to ?? o.labTest.referenceLab ?? ""}
        placeholder={t("Reference lab")}
        aria-label={t("Reference lab")}
        className={`${inputClass} w-56`}
      />
      <datalist id={list}>
        {labs.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <input name="ref" defaultValue={state.values?.ref} placeholder={t("Their number (optional)")} aria-label={t("The reference lab's number")} className={`${inputClass} w-44`} />
      <button disabled={pending} className={`${buttonClass} ${small}`}>
        {pending ? t("Saving…") : t("Sample sent")}
      </button>
      {!o.labTest.sendOut && (
        <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} ${small}`}>
          {t("Cancel")}
        </button>
      )}
      {state.error && (
        <div className="w-full">
          <Alert>{t(state.error)}</Alert>
        </div>
      )}
    </form>
  );
}

/** "At Ethio Lab since 12 Nov (2 d) · their no. EL-5531 · Back in the lab" */
function AtReferenceLab({ o, days }: { o: LabWorkOrder; days: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm dark:bg-sky-950/40">
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="step" value="unsend" />
      <span>
        {t.rich("At {lab} since {days}", { lab: <span className="font-medium">{o.sentTo}</span>, days })}
        {o.sentRef && <span className="text-slate-500"> · {t("their no. {ref}", { ref: o.sentRef })}</span>}
      </span>
      <button disabled={pending} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
        {t("Not sent after all")}
      </button>
      {state.error && <span className="text-xs text-red-700">{t(state.error)}</span>}
    </form>
  );
}

/** Moves a test to the top of the bench with the urgent target (the doctor phoned, the patient got worse). */
function MakeUrgent({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const t = useT();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => setError((await markLabUrgent(id)).error))}
      title={error && t(error)}
      className="text-xs text-slate-500 hover:text-red-700 hover:underline"
    >
      {t(error ? "Couldn't mark urgent" : "Mark urgent")}
    </button>
  );
}

export function BenchRow({
  o,
  prepayment,
  sampleMinutes,
  labs = [],
  sentSince,
  qc,
  reagentShort,
}: {
  o: LabWorkOrder;
  prepayment: boolean;
  /** Minutes since the sample was taken. */
  sampleMinutes?: number | null;
  /** Reference labs to suggest when sending out. */
  labs?: string[];
  /** When the sample went to the reference lab, as shown ("12 Nov, 2 d"). */
  sentSince?: string;
  /** Where the test's QC stands (tests with controls). */
  qc?: QcState;
  /** Reagents this test uses that have run out. */
  reagentShort?: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const lt = o.labTest;
  const t = useT();
  const unpaid = prepayment && o.status === "ORDERED" && !o.paid && !o.emergency;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          {o.urgent && (
            <span className="mr-1.5 rounded bg-red-700 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase dark:bg-red-600">{t("Urgent")}</span>
          )}
          <span className="font-medium">{lt.name}</span>
          {lt.loincCode && <span className="ml-1 font-mono text-xs text-slate-500">LOINC {lt.loincCode}</span>}
          {lt.specimen && <SpecimenTag code={lt.specimen} />}
          {o.sampleId && <span className="ml-2 font-mono text-xs">· {o.sampleId}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {!o.urgent && <MakeUrgent id={o.id} />}
          {/* Results done here wait for passing QC; a reference lab's don't. */}
          {qc && qc.status !== "OK" && !o.sentAt && (
            <Link href={`/lab/qc#qc-${lt.id}`} title={qc.detail ? t(qc.detail) : undefined}>
              <Badge tone={qc.status === "FAIL" ? "danger" : "warning"}>{t(qc.status === "FAIL" ? "QC failed: results held" : qc.status === "DUE" ? "QC due" : "QC warning")}</Badge>
            </Link>
          )}
          {reagentShort?.length && !o.sentAt ? (
            <Link href="/lab/reagents" title={t("No stock on record")}>
              <Badge tone="warning">{t("Out of {list}", { list: reagentShort.join(", ") })}</Badge>
            </Link>
          ) : null}
          {sampleMinutes != null && o.targetMinutes != null && <Clock minutes={sampleMinutes} target={o.targetMinutes} />}
          {unpaid && <Badge tone="danger">{t("Not paid")}</Badge>}
          {o.status === "ORDERED" && o.rejectReason && <Badge tone="warning">{t("New sample needed")}</Badge>}
          {o.critical && o.status === "RESULTED" && <Badge tone="danger">{t("Critical")}</Badge>}
          <Badge tone={o.status === "VERIFIED" ? "success" : o.status === "RESULTED" ? "info" : o.status === "SAMPLE_COLLECTED" ? "brand" : "neutral"} dot>
            {t(LAB_STATUS[o.status])}
          </Badge>
        </span>
      </div>
      {state.error && <Alert>{t(state.error)}</Alert>}

      {o.status === "ORDERED" && o.rejectReason && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {t("The last sample was rejected ({reason}). Take a new sample.", { reason: t(o.rejectReason) })}
        </p>
      )}
      {o.status === "ORDERED" && unpaid && <p className="text-sm text-slate-500">{t("Send the patient to the cashier before taking the sample.")}</p>}
      {/* A lab-only visit has no doctor to cancel its tests: the lab does, when the patient won't have them. */}
      {o.status === "ORDERED" && o.visit.kind === "LAB" && <CancelLabOnly id={o.id} />}

      {o.status === "SAMPLE_COLLECTED" && o.sentAt && <AtReferenceLab o={o} days={sentSince ?? ""} />}
      {o.status === "SAMPLE_COLLECTED" && !o.sentAt && <SendOut o={o} labs={labs} open={!!lt.sendOut} />}
      {(o.status === "RESULTED" || (o.status === "SAMPLE_COLLECTED" && (o.sentAt || !lt.sendOut))) && (
        <form action={action} className="flex flex-wrap items-start gap-2">
          <input type="hidden" name="orderId" value={o.id} />
          <input type="hidden" name="step" value="result" />
          {o.sentAt && o.status === "SAMPLE_COLLECTED" && <span className="w-full text-xs text-slate-500">{t("Result from {lab}, when it comes back:", { lab: o.sentTo ?? "" })}</span>}
          <ResultFields o={o} defaults />
          <button disabled={pending} className={`${o.status === "RESULTED" ? secondaryButtonClass : buttonClass} ${small}`}>
            {t(o.status === "RESULTED" ? "Correct result" : "Save result")}
          </button>
        </form>
      )}

      {o.status === "RESULTED" && (
        <form action={action} className="flex flex-wrap items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
          <input type="hidden" name="orderId" value={o.id} />
          <input type="hidden" name="step" value="verify" />
          <span>
            {t("Entered:")} <LabValue o={o} />
            {o.rangeText && <span className="text-xs text-slate-500"> ({t("ref {range}", { range: o.rangeText })})</span>}{" "}
            {o.resultedBy && <span className="text-xs text-slate-500">{t("by {name}", { name: o.resultedBy.fullName })}</span>}
          </span>
          {o.critical && <CriticalCall required />}
          <button disabled={pending} className={`${buttonClass} ${small}`}>
            {t("Verify and release")}
          </button>
        </form>
      )}

      {(o.status === "SAMPLE_COLLECTED" || o.status === "RESULTED") && <RejectSample o={o} />}
    </li>
  );
}

/** Cancels a lab-only visit's test before its sample is taken; the visit closes when nothing is left. */
function CancelLabOnly({ id }: { id: string }) {
  const t = useT();
  const [reason, setReason] = useState<string>("LEFT_WITHOUT_BEING_SEEN");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Why the test is cancelled")} className={`${inputClass} w-auto py-1 text-xs`}>
        {CANCEL_REASONS.filter((r) => r.value !== "SENT_ELSEWHERE").map((r) => (
          <option key={r.value} value={r.value}>
            {t(r.label)}
          </option>
        ))}
      </select>
      <ConfirmCancel
        disabled={pending}
        label={t("Cancel test")}
        question={t("Cancel this test? The patient won't have it.")}
        onConfirm={() =>
          start(async () => {
            setError(undefined);
            const res = await cancelLabOnlyTest(id, reason);
            if (res.error) setError(res.error);
          })
        }
      />
      {error && <span className="text-xs text-red-700 dark:text-red-400">{t(error)}</span>}
    </div>
  );
}

/**
 * Corrects a released result: the old one is kept, the reason recorded, the report marked
 * "Amended" and the doctor alerted.
 */
export function AmendResult({ o }: { o: LabOrder }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labStep, {});
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-red-700 hover:underline">
        {t("Amend")}
      </button>
    );
  }
  return (
    <form action={action} className="mt-2 flex w-full flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="step" value="amend" />
      {state.error && (
        <div className="w-full">
          <Alert>{t(state.error)}</Alert>
        </div>
      )}
      {state.ok && !pending ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("Amended; the doctor is alerted.")}</p>
      ) : (
        <>
          <p className="w-full text-xs text-slate-600 dark:text-slate-300">
            {t("Corrected result for {test}. The released result is kept with your reason, the report shows “Amended”, and the doctor is alerted.", { test: o.labTest.name })}
          </p>
          <ResultFields o={o} restore={state.values} />
          <input name="reason" required minLength={5} defaultValue={state.values?.reason} placeholder={t("What was wrong with the released result")} aria-label={t("Reason for the amendment")} className={`${inputClass} w-full`} />
          {(state.error?.includes("critical") || isCritical(o.resultFlag)) && <CriticalCall required={false} />}
          <button disabled={pending} className={`${buttonClass} ${small}`}>
            {pending ? t("Saving…") : t("Release corrected result")}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={`${secondaryButtonClass} ${small}`}>
            {t("Cancel")}
          </button>
        </>
      )}
    </form>
  );
}

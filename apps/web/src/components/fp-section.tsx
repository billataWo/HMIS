"use client";

import { HeartHandshake } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { endFp, giveFp, voidFp, type FormState } from "@/app/actions";
import type { FpView } from "@/lib/api";
import { clinicToday, formatDualDate } from "@/lib/format";
import { FP_METHODS, FP_REMOVAL_REASONS, FP_SERVICES, FP_STOP_REASONS } from "@/lib/fp";
import { useT } from "./lang-provider";
import { Alert, Badge, buttonClass, inputClass, secondaryButtonClass } from "./ui";

const day = (d: string) => formatDualDate(`${d.slice(0, 10)}T12:00:00+03:00`);
const small = `${secondaryButtonClass} px-3 py-1.5 text-xs`;

/**
 * Family planning on the patient's record: her current method and when she is due back, giving a
 * method (started or resupplied), removing an implant or IUCD, stopping a method, and every service
 * given, with mistakes voided.
 */
export function FpSection({ patientId, sex, view, canEdit }: { patientId: string; sex: "MALE" | "FEMALE"; view: FpView; canEdit: boolean }) {
  const t = useT();
  const [open, setOpen] = useState<"give" | "end" | null>(null);
  const toggle = (k: typeof open) => setOpen(open === k ? null : k);
  const c = view.current;
  const kind = c ? FP_METHODS[c.method]?.kind : undefined;
  return (
    <section id="family-planning" className="surface scroll-mt-6 space-y-3 p-4 text-sm dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <HeartHandshake aria-hidden className="size-4 text-slate-400" />
          {t("Family planning")}
          {c?.late && <Badge tone="danger">{t("Late for her resupply")}</Badge>}
          {c?.removalDue && <Badge tone="warning">{t("Due for removal")}</Badge>}
        </h2>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => toggle("give")} className={small}>
              {t(c ? "Resupply or change method" : "Give a method")}
            </button>
            {c && kind !== "PERMANENT" && (
              <button type="button" onClick={() => toggle("end")} className={small}>
                {t(kind === "DEVICE" ? "Record removal" : "Record stopping")}
              </button>
            )}
          </div>
        )}
      </div>

      {c ? (
        <p>
          <span className="text-slate-500">{t("Current method:")}</span> <span className="font-semibold">{t(FP_METHODS[c.method]?.label ?? c.method)}</span>{" "}
          <span className="text-slate-500">· {t("since {date}", { date: day(c.since) })}</span>
          {c.nextDueOn && (
            <span className={c.late ? "font-semibold text-red-700 dark:text-red-400" : "text-slate-500"}>
              {" "}
              · {t(c.device ? "out by {date}" : "next due {date}", { date: day(c.nextDueOn) })}
            </span>
          )}
        </p>
      ) : (
        <p className="text-slate-500">{t(view.servedBefore ? "No current method." : "No family planning recorded here.")}</p>
      )}

      {open === "give" && <GiveForm patientId={patientId} sex={sex} view={view} onDone={() => setOpen(null)} />}
      {open === "end" && c && <EndForm patientId={patientId} device={kind === "DEVICE"} onDone={() => setOpen(null)} />}

      {view.records.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                {["Date", "Service", "Method", "Given", "Client", "Next due"].map((h) => (
                  <th key={h} className="py-1 pr-3 font-medium">
                    {t(h)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {view.records.map((r) => {
                const def = FP_METHODS[r.method];
                return (
                  <tr key={r.id} className={r.voidedAt ? "text-slate-400 dark:text-slate-600" : undefined}>
                    <td className={`py-1.5 pr-3 whitespace-nowrap ${r.voidedAt ? "line-through" : ""}`}>{day(r.givenOn)}</td>
                    <td className="py-1.5 pr-3">{t(FP_SERVICES[r.service] ?? r.service)}</td>
                    <td className="py-1.5 pr-3">{t(def?.label ?? r.method)}</td>
                    <td className="py-1.5 pr-3">{r.quantity && def?.unit ? `${r.quantity} ${t(def.unit)}` : "—"}</td>
                    <td className="py-1.5 pr-3">{r.clientType ? t(r.clientType === "NEW" ? "New" : "Repeat") : "—"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.nextDueOn ? day(r.nextDueOn) : "—"}</td>
                    <td className="py-1.5 text-slate-500">
                      {r.voidedAt
                        ? t("Void: {reason}", { reason: r.voidReason ?? "" })
                        : [r.reason && t((r.service === "REMOVAL" ? FP_REMOVAL_REASONS : FP_STOP_REASONS)[r.reason] ?? r.reason), r.note, r.by].filter(Boolean).join(" · ")}
                      {canEdit && !r.voidedAt && <VoidRecord id={r.id} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function useDone(fn: (s: FormState, f: FormData) => Promise<FormState>, onDone: () => void) {
  return useActionState<FormState, FormData>(async (prev, form) => {
    const r = await fn(prev, form);
    if (r.ok) onDone();
    return r;
  }, {});
}

/** A method given: the API records it as started or resupplied. */
function GiveForm({ patientId, sex, view, onDone }: { patientId: string; sex: "MALE" | "FEMALE"; view: FpView; onDone: () => void }) {
  const t = useT();
  const [state, action, pending] = useDone(giveFp, onDone);
  const v = state.values ?? {};
  const options = Object.entries(FP_METHODS).filter(([, m]) => m.sex === "ANY" || m.sex === sex);
  const [method, setMethod] = useState<string>(v.method ?? view.current?.method ?? options[0][0]);
  const def = FP_METHODS[method];
  return (
    <form action={action} className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
      <input type="hidden" name="patientId" value={patientId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t("Method")} className={`${inputClass} w-72`}>
          {options.map(([k, m]) => (
            <option key={k} value={k}>
              {t(m.label)}
            </option>
          ))}
        </select>
        {def?.unit && (
          <label className="flex items-center gap-1">
            <input key={method} name="quantity" type="number" min={1} max={def.max} required defaultValue={v.quantity ?? (def.unit === "cycles" ? "3" : "")} className={`${inputClass} w-20`} />
            {t(def.unit)}
          </label>
        )}
        <input name="givenOn" type="date" max={clinicToday()} defaultValue={v.givenOn ?? clinicToday()} aria-label={t("Date given")} className={`${inputClass} w-40`} />
      </div>
      {!view.servedBefore && (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 font-medium">{t("Has she used a modern method before (anywhere)?")}</legend>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="clientType" value="NEW" defaultChecked={(v.clientType ?? "NEW") === "NEW"} /> {t("No: a new acceptor")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="clientType" value="REPEAT" defaultChecked={v.clientType === "REPEAT"} /> {t("Yes: a repeat acceptor")}
          </label>
        </fieldset>
      )}
      <input name="note" defaultValue={v.note} placeholder={t("Note (optional)")} aria-label={t("Note")} className={inputClass} />
      <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
        {pending ? t("Saving…") : t("Record")}
      </button>
    </form>
  );
}

/** An implant or IUCD removed, or a method stopped, with why. */
function EndForm({ patientId, device, onDone }: { patientId: string; device: boolean; onDone: () => void }) {
  const t = useT();
  const [state, action, pending] = useDone(endFp, onDone);
  const reasons = device ? FP_REMOVAL_REASONS : FP_STOP_REASONS;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="kind" value={device ? "removal" : "stop"} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <select name="reason" required defaultValue="" aria-label={t("Why")} className={`${inputClass} w-64`}>
        <option value="" disabled>
          {t("Why…")}
        </option>
        {Object.entries(reasons).map(([k, label]) => (
          <option key={k} value={k}>
            {t(label)}
          </option>
        ))}
      </select>
      <input name="givenOn" type="date" max={clinicToday()} defaultValue={clinicToday()} aria-label={t("Date")} className={`${inputClass} w-40`} />
      <input name="note" placeholder={t("Note (optional)")} aria-label={t("Note")} className={`${inputClass} min-w-0 flex-1`} />
      <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
        {pending ? t("Saving…") : t(device ? "Record removal" : "Record stopping")}
      </button>
    </form>
  );
}

/** Voids an entry recorded by mistake; her current method is worked out again without it. */
function VoidRecord({ id }: { id: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ml-2 text-slate-400 hover:text-red-700 hover:underline">
        {t("Void")}
      </button>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why (e.g. wrong client)")} aria-label={t("Why the entry is voided")} className={`${inputClass} w-48 py-1 text-xs`} />
      <button
        type="button"
        disabled={pending || reason.trim().length < 3}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const res = await voidFp(id, reason.trim());
            if (res.error) setError(res.error);
            else setOpen(false);
          })
        }
        className="font-medium text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
      >
        {t("Void it")}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="hover:underline">
        {t("Keep")}
      </button>
      {error && <span className="text-red-700 dark:text-red-400">{t(error)}</span>}
    </span>
  );
}

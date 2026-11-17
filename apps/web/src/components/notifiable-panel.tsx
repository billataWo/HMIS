"use client";

import { CircleCheck, Megaphone } from "lucide-react";
import { useActionState } from "react";
import { reportDisease, type FormState } from "@/app/actions";
import type { VisitNotifiable } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";
import { useT } from "./lang-provider";
import { Alert, buttonClass, inputClass } from "./ui";

/**
 * Diseases public health must hear about (IDSR). An immediately reportable one is phoned through to
 * the woreda health office within 30 minutes and recorded here; weekly ones only need counting.
 */
export function NotifiablePanel({ visitId, items, canReport }: { visitId: string; items: VisitNotifiable[]; canReport: boolean }) {
  const immediate = items.filter((d) => d.immediate);
  const weekly = items.filter((d) => !d.immediate);
  const t = useT();
  if (!items.length) return null;
  return (
    <section id="notifiable" className="scroll-mt-6 space-y-3">
      {immediate.map((d) => (d.notification ? <Reported key={d.key} d={d} /> : <ToReport key={d.key} visitId={visitId} d={d} canReport={canReport} />))}
      {weekly.length > 0 && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
          {t("Notifiable: {list}. Counted on the weekly IDSR report, no case report needed.", { list: weekly.map((d) => (t.lang === "am" && d.labelAm ? d.labelAm : d.label)).join(", ") })}
        </p>
      )}
    </section>
  );
}

function Reported({ d }: { d: VisitNotifiable }) {
  const n = d.notification!;
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        {n.reportedBy
          ? t.rich("{disease} reported to {to} by {by}", { disease: <strong>{d.label}</strong>, to: n.reportedTo, by: n.reportedBy })
          : t.rich("{disease} reported to {to}", { disease: <strong>{d.label}</strong>, to: n.reportedTo })}{" "}
        · {formatDualDate(n.reportedAt)} {formatTime(n.reportedAt)}
        {n.note && <span className="block text-xs opacity-80">{n.note}</span>}
      </p>
    </div>
  );
}

function ToReport({ visitId, d, canReport }: { visitId: string; d: VisitNotifiable; canReport: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reportDisease, {});
  const v = state.values ?? {};
  const t = useT();
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      <p className="flex items-start gap-2">
        <Megaphone aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong>
            {d.label} · <span lang="am">{d.labelAm}</span>
          </strong>{" "}
          {t("is immediately reportable. Phone the woreda health office (PHEM) within 30 minutes, then send the written case form.")}
        </span>
      </p>
      {canReport && (
        <form action={action} className="space-y-2">
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="disease" value={d.key} />
          {state.error && <Alert>{t(state.error)}</Alert>}
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="reportedTo" required minLength={2} defaultValue={v.reportedTo} placeholder={t("Reported to (office and person)")} aria-label={t("Reported to")} className={inputClass} />
            <input name="note" defaultValue={v.note} placeholder={t("Note (optional), e.g. sample requested")} aria-label={t("Note")} className={inputClass} />
          </div>
          <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
            {pending ? t("Saving…") : t("Record as reported")}
          </button>
        </form>
      )}
    </div>
  );
}

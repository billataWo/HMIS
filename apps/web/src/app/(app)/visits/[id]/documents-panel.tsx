"use client";

import { FileText, Printer } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { issueDocument, type FormState } from "@/app/actions";
import { Alert, Badge, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";
import type { ClinicalDocument } from "@/lib/api";
import { clinicToday, formatDualDate } from "@/lib/format";
import { REFERRAL_STATUS } from "@/lib/referrals";

const LABEL = { MEDICAL_CERTIFICATE: "Medical certificate", REFERRAL: "Referral letter" } as const;

/** Medical (sick-leave) certificates and referral letters: issued once, kept with the visit, printed. */
export function DocumentsPanel({ visitId, documents, canIssue, diagnosis }: { visitId: string; documents: ClinicalDocument[]; canIssue: boolean; diagnosis: string }) {
  const [type, setType] = useState<keyof typeof LABEL | null>(null);
  return (
    <section className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
          <FileText aria-hidden className="size-4 text-slate-400" />
          Certificates and referrals
        </h2>
        {canIssue && !type && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setType("MEDICAL_CERTIFICATE")} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
              Medical certificate
            </button>
            <button type="button" onClick={() => setType("REFERRAL")} className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}>
              Referral letter
            </button>
          </div>
        )}
      </div>
      {documents.length === 0 && !type && <p className="text-sm text-slate-500">None issued for this visit.</p>}
      {documents.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium">{LABEL[d.type]}</span>
                {d.type === "REFERRAL" && d.data.to && <span> to {String(d.data.to)}</span>}
                <span className="text-xs text-slate-500"> · {formatDualDate(d.createdAt)}</span>
                {d.referralStatus && (
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone={REFERRAL_STATUS[d.referralStatus].tone}>{REFERRAL_STATUS[d.referralStatus].label}</Badge>
                    {d.followUps?.at(-1)?.note && <span className="min-w-0 break-words">{d.followUps.at(-1)!.note}</span>}
                    <Link href="/referrals?view=all" className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                      Follow up
                    </Link>
                  </span>
                )}
              </span>
              <Link href={`/document/${d.id}`} target="_blank" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">
                <Printer aria-hidden className="size-3.5" />
                Print
              </Link>
            </li>
          ))}
        </ul>
      )}
      {type && <DocumentForm key={type} visitId={visitId} type={type} diagnosis={diagnosis} onCancel={() => setType(null)} />}
    </section>
  );
}

function DocumentForm({ visitId, type, diagnosis, onCancel }: { visitId: string; type: keyof typeof LABEL; diagnosis: string; onCancel: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(issueDocument, {});
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="type" value={type} />
      <p className="font-medium">{LABEL[type]}</p>
      {state.error && <Alert>{state.error}</Alert>}
      {type === "MEDICAL_CERTIFICATE" ? (
        <>
          <Field label="Diagnosis" error={err.diagnosis}>
            <Input name="diagnosis" required defaultValue={v.diagnosis ?? diagnosis} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rest (days)" error={err.restDays} hint="0 if fit to work">
              <Input name="restDays" type="number" min={0} max={90} required defaultValue={v.restDays ?? "3"} />
            </Field>
            <Field label="Starting" error={err.fromDate}>
              <Input name="fromDate" type="date" required defaultValue={v.fromDate ?? clinicToday()} />
            </Field>
          </div>
          <Field label="Remarks" error={err.remarks}>
            <textarea name="remarks" rows={2} defaultValue={v.remarks} className={inputClass} placeholder="e.g. light duty only, review after rest" />
          </Field>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <Field label="Referred to" error={err.to}>
              <Input name="to" required defaultValue={v.to} placeholder="Hospital and department" />
            </Field>
            <Field label="Urgency">
              <select name="urgency" defaultValue={v.urgency ?? "ROUTINE"} className={inputClass}>
                <option value="ROUTINE">Routine</option>
                <option value="URGENT">Urgent</option>
                <option value="EMERGENCY">Emergency</option>
              </select>
            </Field>
          </div>
          <Field label="Reason for referral" error={err.reason}>
            <Input name="reason" required defaultValue={v.reason} />
          </Field>
          <Field label="History and findings" error={err.summary}>
            <textarea name="summary" rows={4} required defaultValue={v.summary} className={inputClass} />
          </Field>
          <Field label="Treatment given" error={err.treatmentGiven}>
            <textarea name="treatmentGiven" rows={2} defaultValue={v.treatmentGiven} className={inputClass} />
          </Field>
        </>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Issuing…" : "Issue and print"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}

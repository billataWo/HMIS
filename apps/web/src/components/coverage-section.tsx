"use client";

import { useActionState, useState } from "react";
import { saveCoverage, type FormState } from "@/app/actions";
import type { PatientCoverage } from "@/lib/api";
import { isPast } from "@/lib/format";
import { useT } from "./lang-provider";
import { Alert, Badge, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "./ui";

type PayerOption = { id: string; name: string; type: "CREDIT" | "INSURANCE"; coPayPercent: string; requiresAuthorization: boolean };

const small = "px-3 py-1 text-xs";
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function CoverageForm({ patientId, payers, c, onDone }: { patientId: string; payers: PayerOption[]; c?: PatientCoverage; onDone: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev: FormState, form: FormData) => {
    const res = await saveCoverage(prev, form);
    if (res.ok) onDone();
    return res;
  }, {});
  const v = state.values ?? {};
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      {state.error && <Alert>{t(state.error)}</Alert>}
      <input type="hidden" name="patientId" value={patientId} />
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!c && (
          <Field label={t("Credit company or insurer")} error={err.payerId}>
            <select name="payerId" required defaultValue={v.payerId ?? ""} className={inputClass}>
              <option value="" disabled>
                {t("Choose…")}
              </option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {Number(p.coPayPercent) > 0 ? ` · ${t("{n}% co-pay", { n: Number(p.coPayPercent) })}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("Member / employee ID")} error={err.memberId}>
          <Input name="memberId" defaultValue={v.memberId ?? c?.memberId ?? ""} />
        </Field>
        <Field label={t("Covered through (dependants)")} error={err.holder} hint={t("e.g. Spouse of Abebe Kebede")}>
          <Input name="holder" defaultValue={v.holder ?? c?.holder ?? ""} />
        </Field>
        <Field label={t("Valid until")} error={err.validUntil}>
          <Input name="validUntil" type="date" defaultValue={v.validUntil ?? day(c?.validUntil ?? null)} />
        </Field>
      </div>
      {c && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={c.active} /> {t("Active (offered at check-in)")}
        </label>
      )}
      <div className="flex gap-2">
        <button disabled={pending} className={`${buttonClass} ${small}`}>
          {pending ? t("Saving…") : c ? t("Save") : t("Add coverage")}
        </button>
        <button type="button" onClick={onDone} className={`${secondaryButtonClass} ${small}`}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Who pays for the patient: a company that pays for its employees, or an insurer, with the member
 * number the payer knows them by. Check-in offers these.
 */
export function CoverageSection({ patientId, coverages, payers, canEdit }: { patientId: string; coverages: PatientCoverage[]; payers: PayerOption[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const t = useT();
  return (
    <section id="coverage" className="surface scroll-mt-6 space-y-3 p-4 dark:border-slate-800">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">{t("Coverage")}</h2>
        {canEdit && payers.length > 0 && editing !== "new" && (
          <button type="button" onClick={() => setEditing("new")} className="text-sm text-brand-700 hover:underline dark:text-brand-400">
            {t("Add coverage")}
          </button>
        )}
      </div>
      {coverages.length === 0 && editing !== "new" && (
        <p className="text-sm text-slate-500">{t(payers.length ? "Pays for their own care." : "Pays for their own care. (No credit companies or insurers are set up.)")}</p>
      )}
      <ul className="space-y-2 text-sm">
        {coverages.map((c) =>
          editing === c.id ? (
            <li key={c.id}>
              <CoverageForm patientId={patientId} payers={payers} c={c} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={c.id} className={`flex flex-wrap items-baseline justify-between gap-2 ${c.active ? "" : "opacity-60"}`}>
              <span>
                <span className="font-medium">{c.payer.name}</span>
                <span className="text-slate-500">
                  {c.memberId && ` · ${c.memberId}`}
                  {c.holder && ` · ${c.holder}`}
                  {` · ${Number(c.payer.coPayPercent) > 0 ? t("{n}% co-pay", { n: Number(c.payer.coPayPercent) }) : t("fully covered")}`}
                  {c.payer.requiresAuthorization && ` · ${t("needs authorization")}`}
                  {c.validUntil && ` · ${t("until {date}", { date: day(c.validUntil) })}`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {!c.active ? <Badge>{t("Not in use")}</Badge> : c.validUntil && isPast(c.validUntil) ? <Badge tone="danger">{t("Ended")}</Badge> : <Badge tone="success">{t("Active")}</Badge>}
                {canEdit && (
                  <button type="button" onClick={() => setEditing(c.id)} className="text-xs text-slate-500 hover:underline">
                    {t("Edit")}
                  </button>
                )}
              </span>
            </li>
          ),
        )}
      </ul>
      {editing === "new" && <CoverageForm patientId={patientId} payers={payers} onDone={() => setEditing(null)} />}
    </section>
  );
}

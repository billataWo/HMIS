"use client";

import { Printer, Syringe } from "lucide-react";
import Link from "next/link";
import { Fragment, useActionState, useState } from "react";
import { giveDose, voidDose, type FormState } from "@/app/actions";
import type { ImmunizationRecord, ScheduledDose } from "@/lib/api";
import { clinicToday, formatDualDate } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { DOSE_STATUS, milestoneText, SITES } from "@/lib/immunization";
import { useT } from "./lang-provider";
import { Alert, Badge, buttonClass, inputClass } from "./ui";

const day = (d: string) => formatDualDate(`${d.slice(0, 10)}T12:00:00+03:00`);
const small = "rounded-md px-2 py-1 text-xs font-medium";

/** When a dose not yet given is due: none while it waits for the one before; Td and HPV are given at any visit. */
export function dueText(d: ScheduledDose, t: T) {
  if (d.waitingFor) return "";
  if (d.status === "DUE" && (d.vaccine === "TD" || d.vaccine === "HPV")) return t("due now");
  return t("due {date}", { date: day(d.dueOn) });
}

/**
 * The patient's vaccinations, worked out from their birth date: each dose given (when, lot, where),
 * due, late or coming up. Nurses and doctors record a dose given here or copied from the card,
 * and void one recorded by mistake.
 */
export function ImmunizationCard({ patientId, record, canGive }: { patientId: string; record: ImmunizationRecord; canGive: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const today = clinicToday();
  const late = record.schedule.filter((d) => d.status === "OVERDUE").length;
  // Up to the next visit's doses; later ones fold away until asked for.
  const firstAhead = record.schedule.find((d) => d.status === "UPCOMING");
  const cut = firstAhead ? record.schedule.findLastIndex((d) => d.milestone === firstAhead.milestone) + 1 : record.schedule.length;
  const shown = all ? record.schedule : record.schedule.slice(0, cut);
  const hidden = record.schedule.length - shown.length;
  const voided = record.doses.filter((d) => d.voidedAt);
  const t = useT();
  return (
    <section id="immunization" className="surface scroll-mt-6 space-y-3 p-4 text-sm dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Syringe aria-hidden className="size-4 text-slate-400" />
          {t("Immunization")}
          {late > 0 && <Badge tone="danger">{t("{n} late", { n: late })}</Badge>}
        </h2>
        <Link href={`/immunization-card/${patientId}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">
          <Printer aria-hidden className="size-3.5" />
          {t("Print card")}
        </Link>
      </div>
      {!record.dobKnown && <p className="text-amber-700 dark:text-amber-400">{t("Record the birth date or age to see the schedule.")}</p>}
      {record.dobEstimated && <p className="text-xs text-slate-500">{t("The birth date is estimated from the age given: due dates are approximate.")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">{t("When")}</th>
              <th className="py-1 pr-3 font-medium">{t("Dose")}</th>
              <th className="py-1 pr-3 font-medium">{t("State")}</th>
              <th className="py-1 pr-3 font-medium">{t("Date")}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((d, i) => {
              const key = `${d.vaccine}-${d.doseNo}`;
              const first = i === 0 || shown[i - 1].milestone !== d.milestone;
              const dose = d.given && record.doses.find((x) => x.id === d.given!.id);
              const s = DOSE_STATUS[d.status];
              return (
                <Fragment key={key}>
                  <tr className={d.status === "MISSED" ? "text-slate-400" : undefined}>
                    <td className="py-1.5 pr-3 align-top text-xs text-slate-500">{first ? milestoneText(t, d.milestone) : ""}</td>
                    <td className="py-1.5 pr-3 align-top font-medium">{d.label}</td>
                    <td className="py-1.5 pr-3 align-top">
                      <Badge tone={s.tone}>{t(s.label)}</Badge>
                      {d.waitingFor && d.status !== "GIVEN" && <span className="block text-xs text-slate-500">{t("after {dose}", { dose: d.waitingFor })}</span>}
                    </td>
                    <td className="py-1.5 pr-3 align-top">
                      {dose ? (
                        <>
                          {day(dose.givenOn)}
                          <span className="block text-xs text-slate-500">
                            {[dose.elsewhere ? t("at {place}", { place: dose.facility ?? "" }) : dose.givenBy, dose.lotNo && t("lot {lot}", { lot: dose.lotNo }), dose.site && t(dose.site)].filter(Boolean).join(" · ")}
                          </span>
                        </>
                      ) : d.status === "MISSED" ? (
                        ""
                      ) : (
                        <span className="text-slate-500">{dueText(d, t)}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right align-top whitespace-nowrap">
                      {canGive && !d.given && d.status !== "MISSED" && !d.waitingFor && d.notBefore <= today && (
                        <button type="button" onClick={() => setOpen(open === key ? null : key)} className={`${small} text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950`}>
                          {t(open === key ? "Close" : "Record")}
                        </button>
                      )}
                      {canGive && dose && (
                        <button type="button" onClick={() => setOpen(open === `void-${key}` ? null : `void-${key}`)} className={`${small} text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800`}>
                          {t("Void")}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === key && (
                    <tr>
                      <td colSpan={5} className="pb-3">
                        <GiveForm patientId={patientId} dose={d} onDone={() => setOpen(null)} />
                      </td>
                    </tr>
                  )}
                  {open === `void-${key}` && dose && (
                    <tr>
                      <td colSpan={5} className="pb-3">
                        <VoidForm doseId={dose.id} label={d.label} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">
          {t(hidden === 1 ? "Show {n} later dose" : "Show {n} later doses", { n: hidden })}
        </button>
      )}
      {voided.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{t(voided.length === 1 ? "{n} voided entry" : "{n} voided entries", { n: voided.length })}</summary>
          <ul className="mt-1 space-y-0.5">
            {voided.map((v) => (
              <li key={v.id}>
                <s>
                  {v.label} {day(v.givenOn)}
                </s>{" "}
                · {v.voidReason} ({v.voidedBy})
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function GiveForm({ patientId, dose, onDone }: { patientId: string; dose: ScheduledDose; onDone: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const r = await giveDose(prev, form);
    if (r.ok) onDone();
    return r;
  }, {});
  const [elsewhere, setElsewhere] = useState(false);
  const v = state.values ?? {};
  const t = useT();
  return (
    <form action={action} className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="vaccine" value={dose.vaccine} />
      <input type="hidden" name="doseNo" value={dose.doseNo} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <p className="text-xs font-medium">{dose.label}</p>
      <div className="flex flex-wrap gap-2">
        <input name="givenOn" type="date" max={clinicToday()} defaultValue={v.givenOn ?? clinicToday()} aria-label={t("Date given")} className={`${inputClass} w-40`} />
        {!elsewhere && (
          <>
            <input name="lotNo" placeholder={t("Lot number")} defaultValue={v.lotNo} aria-label={t("Lot number")} className={`${inputClass} w-36`} />
            <select name="site" defaultValue={v.site ?? ""} aria-label={t("Site")} className={`${inputClass} w-40`}>
              <option value="">{t("Site")}</option>
              {SITES.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="elsewhere" checked={elsewhere} onChange={(e) => setElsewhere(e.target.checked)} />
        {t("Given at another facility (copied from the card)")}
      </label>
      {elsewhere && <input name="facility" required placeholder={t("Where it was given")} defaultValue={v.facility} aria-label={t("Facility")} className={inputClass} />}
      <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
        {pending ? t("Saving…") : t(elsewhere ? "Record from the card" : "Record dose")}
      </button>
    </form>
  );
}

function VoidForm({ doseId, label }: { doseId: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(voidDose, {});
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
      <input type="hidden" name="doseId" value={doseId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <span className="text-xs font-medium text-red-800 dark:text-red-200">{t("Void {dose}?", { dose: label })}</span>
      <input name="reason" required minLength={3} placeholder={t("Why (e.g. recorded on the wrong child)")} aria-label={t("Reason")} className={`${inputClass} min-w-0 flex-1`} />
      <button disabled={pending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
        {pending ? t("Voiding…") : t("Void")}
      </button>
    </form>
  );
}

"use client";

import { Baby, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment, useActionState, useState } from "react";
import { endPregnancy, recordAncContact, registerPregnancy, type FormState } from "@/app/actions";
import type { AncContact, Pregnancy } from "@/lib/api";
import { BLOOD_GROUPS, DANGER_SIGNS, OUTCOMES, PRESENTATION, RISK_FACTORS, TEST_RESULT, URINE_PROTEIN } from "@/lib/anc";
import { clinicToday, formatDualDate } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { useT } from "./lang-provider";
import { Alert, Badge, buttonClass, Field, inputClass, secondaryButtonClass } from "./ui";

const day = (d: string) => formatDualDate(`${d.slice(0, 10)}T12:00:00+03:00`);
const small = `${secondaryButtonClass} px-3 py-1.5 text-xs`;
const ga = (w: number, d: number, t: T) => [t("{n}w", { n: w }), d ? t("{n} d", { n: d }) : ""].filter(Boolean).join(" ");

/** The API's alert text in the screen's language; the danger-sign alert lists the signs. */
function alertText(t: T, text: string) {
  const m = /^Danger signs?: (.*)\. Assess now and refer$/.exec(text);
  if (!m) return t(text);
  return t("Danger signs: {list}. Assess now and refer", { list: m[1].split(", ").map((s) => t(s)).join(", ") });
}

/**
 * Antenatal care on the patient's record: register a pregnancy (from the last period or an
 * ultrasound date), record each of the eight contacts with what it found, see the alerts, the next
 * contact, and end the follow-up when she delivers.
 */
export function AncSection({ patientId, pregnancies, canEdit }: { patientId: string; pregnancies: Pregnancy[]; canEdit: boolean }) {
  const active = pregnancies.find((p) => p.status === "ACTIVE");
  const past = pregnancies.filter((p) => p.status !== "ACTIVE");
  const [open, setOpen] = useState<"register" | "contact" | "end" | null>(null);
  const toggle = (k: typeof open) => setOpen(open === k ? null : k);
  const t = useT();
  return (
    <section id="anc" className="surface scroll-mt-6 space-y-3 p-4 text-sm dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Baby aria-hidden className="size-4 text-slate-400" />
          {t("Antenatal care")}
          {active?.late && <Badge tone="danger">{t("Late for her contact")}</Badge>}
        </h2>
        <div className="flex flex-wrap gap-2">
          {active && (
            <Link href={`/anc-card/${active.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">
              <Printer aria-hidden className="size-3.5" />
              {t("Print ANC card")}
            </Link>
          )}
          {canEdit && !active && (
            <button type="button" onClick={() => toggle("register")} className={small}>
              {t("Register pregnancy")}
            </button>
          )}
          {canEdit && active && (
            <>
              <button type="button" onClick={() => toggle("contact")} className={small}>
                {t("Record contact")}
              </button>
              <button type="button" onClick={() => toggle("end")} className={small}>
                {t("End follow-up")}
              </button>
            </>
          )}
        </div>
      </div>

      {!active && !past.length && open !== "register" && <p className="text-slate-500">{t("No pregnancy followed here.")}</p>}
      {open === "register" && <RegisterForm patientId={patientId} onDone={() => setOpen(null)} />}

      {active && (
        <>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div>
              <dt className="inline text-slate-500">{t("Now:")} </dt>
              <dd className="inline font-semibold">{active.gestation && t("{w} weeks {d} days", { w: active.gestation.weeks, d: active.gestation.days })}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">{t("Due:")} </dt>
              <dd className="inline font-semibold">
                {day(active.edd)} <span className="font-normal text-slate-500">({t(active.eddSource === "ULTRASOUND" ? "ultrasound" : "from last period")})</span>
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-500">{t("Pregnancies / births:")} </dt>
              <dd className="inline">
                G{active.gravida} P{active.para}
                {active.bloodGroup && ` · ${t("blood group {group}", { group: active.bloodGroup })}`}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-500">{t("Next contact:")} </dt>
              <dd className={`inline ${active.late ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{active.nextContactOn ? day(active.nextContactOn) : t("now (first contact)")}</dd>
            </div>
          </dl>
          {active.risks.length > 0 && (
            <p className="flex flex-wrap gap-1.5">
              {active.risks.map((r) => (
                <Badge key={r.key} tone="warning">
                  {t(r.label)}
                </Badge>
              ))}
            </p>
          )}
          {open === "contact" && <ContactForm pregnancyId={active.id} onDone={() => setOpen(null)} />}
          {open === "end" && <EndForm pregnancyId={active.id} />}
          <Contacts contacts={active.contacts} />
        </>
      )}

      {past.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{t("Earlier pregnancies ({n})", { n: past.length })}</summary>
          <ul className="mt-1 space-y-0.5">
            {past.map((p) => (
              <li key={p.id}>
                {t("Due {date}", { date: day(p.edd) })} · {t(OUTCOMES[p.outcome ?? ""] ?? p.outcome ?? "")}
                {p.endedOn && ` · ${day(p.endedOn)}`} · {t(p.contacts.length === 1 ? "{n} contact" : "{n} contacts", { n: p.contacts.length })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Contacts({ contacts }: { contacts: AncContact[] }) {
  const t = useT();
  if (!contacts.length) return <p className="text-slate-500">{t("No contact recorded yet.")}</p>;
  const tests = (c: AncContact) =>
    [
      [t("Syphilis"), c.syphilis],
      ["HIV", c.hiv],
      ["HBsAg", c.hbsag],
    ]
      .filter(([, v]) => v && v !== "NOT_DONE")
      .map(([k, v]) => `${k} ${v === "POSITIVE" ? "+" : "−"}`)
      .join(", ");
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left">
        <thead className="text-xs text-slate-500">
          <tr>
            {["#", "Date", "Weeks", "BP", "Weight", "Fundus", "Fetal heart", "Urine protein", "Hb", "Tests"].map((h) => (
              <th key={h} className="py-1 pr-3 font-medium">
                {t(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {contacts.map((c) => (
            <Fragment key={c.id}>
              <tr>
                <td className="py-1.5 pr-3 font-semibold">{c.contactNo}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{day(c.contactOn)}</td>
                <td className="py-1.5 pr-3">{ga(c.gaWeeks, c.gaDays, t)}</td>
                <td className="py-1.5 pr-3">{c.systolicBp ? `${c.systolicBp}/${c.diastolicBp ?? "?"}` : "—"}</td>
                <td className="py-1.5 pr-3">{c.weightKg ? `${Number(c.weightKg)} kg` : "—"}</td>
                <td className="py-1.5 pr-3">{c.fundalHeightCm ? `${c.fundalHeightCm} cm` : "—"}</td>
                <td className="py-1.5 pr-3">{c.fetalHeartRate ?? "—"}</td>
                <td className="py-1.5 pr-3">{c.urineProtein ? t(URINE_PROTEIN[c.urineProtein]) : "—"}</td>
                <td className="py-1.5 pr-3">{c.hb ? Number(c.hb) : "—"}</td>
                <td className="py-1.5 pr-3">{tests(c) || "—"}</td>
              </tr>
              {(c.alerts.length > 0 || c.dangerSigns.length > 0 || c.note || c.presentation || c.ifaTablets || c.dewormed) && (
                <tr>
                  <td />
                  <td colSpan={9} className="pb-2 text-xs">
                    {c.alerts.map((a) => (
                      <p key={a.text} className={`flex items-center gap-1 ${a.level === "URGENT" ? "font-medium text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                        <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                        {alertText(t, a.text)}
                      </p>
                    ))}
                    <p className="text-slate-500">
                      {[
                        c.presentation && t(PRESENTATION[c.presentation]),
                        c.ifaTablets && t("{n} iron-folic acid tablets", { n: c.ifaTablets }),
                        c.dewormed && t("dewormed"),
                        c.note,
                        c.by,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useDone(fn: (s: FormState, f: FormData) => Promise<FormState>, onDone?: () => void) {
  return useActionState<FormState, FormData>(async (prev, form) => {
    const r = await fn(prev, form);
    if (r.ok) onDone?.();
    return r;
  }, {});
}

function RegisterForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [state, action, pending] = useDone(registerPregnancy, onDone);
  const [kind, setKind] = useState<"lmp" | "edd">("lmp");
  const v = state.values ?? {};
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  return (
    <form action={action} className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="dateKind" value={kind} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <div className="flex gap-3 text-xs">
        <button type="button" onClick={() => setKind("lmp")} className={kind === "lmp" ? "font-semibold" : "text-slate-500 underline"}>
          {t("Last period")}
        </button>
        <button type="button" onClick={() => setKind("edd")} className={kind === "edd" ? "font-semibold" : "text-slate-500 underline"}>
          {t("Due date from ultrasound")}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {kind === "lmp" ? (
          <Field label={t("First day of last period")} error={err.lmp}>
            <input name="lmp" type="date" required max={clinicToday()} defaultValue={v.lmp} className={inputClass} />
          </Field>
        ) : (
          <Field label={t("Due date (ultrasound)")} error={err.edd ?? err.lmp}>
            <input name="edd" type="date" required defaultValue={v.edd} className={inputClass} />
          </Field>
        )}
        <Field label={t("Pregnancies (gravida)")} error={err.gravida} hint={t("this one included")}>
          <input name="gravida" type="number" required min={1} max={20} defaultValue={v.gravida ?? "1"} className={inputClass} />
        </Field>
        <Field label={t("Births (para)")} error={err.para}>
          <input name="para" type="number" required min={0} max={19} defaultValue={v.para ?? "0"} className={inputClass} />
        </Field>
        <Field label={t("Blood group")} error={err.bloodGroup}>
          <select name="bloodGroup" defaultValue={v.bloodGroup ?? ""} className={inputClass}>
            <option value="">{t("Not known")}</option>
            {BLOOD_GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="grid gap-1 sm:grid-cols-2">
        <legend className="mb-1 text-xs font-semibold text-slate-500">{t("Risk factors (age and five or more births are added by themselves)")}</legend>
        {Object.entries(RISK_FACTORS).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="riskFactors" value={k} />
            {t(label)}
          </label>
        ))}
      </fieldset>
      <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
        {pending ? t("Saving…") : t("Register pregnancy")}
      </button>
    </form>
  );
}

const select = (name: string, options: Record<string, string>, label: string, t: T) => (
  <Field label={t(label)}>
    <select name={name} defaultValue="" className={inputClass}>
      <option value="">—</option>
      {Object.entries(options).map(([k, l]) => (
        <option key={k} value={k}>
          {t(l)}
        </option>
      ))}
    </select>
  </Field>
);

function ContactForm({ pregnancyId, onDone }: { pregnancyId: string; onDone: () => void }) {
  const [state, action, pending] = useDone(recordAncContact, onDone);
  const t = useT();
  const n = (name: string, label: string, min: number, max: number, step = 1) => (
    <Field label={t(label)}>
      <input name={name} type="number" min={min} max={max} step={step} className={inputClass} />
    </Field>
  );
  return (
    <form action={action} className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
      <input type="hidden" name="pregnancyId" value={pregnancyId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("Date")}>
          <input name="contactOn" type="date" max={clinicToday()} defaultValue={clinicToday()} className={inputClass} />
        </Field>
        {n("weightKg", "Weight (kg)", 25, 250, 0.1)}
        {n("systolicBp", "BP systolic", 60, 260)}
        {n("diastolicBp", "BP diastolic", 30, 160)}
        {n("fundalHeightCm", "Fundal height (cm)", 5, 50)}
        {n("fetalHeartRate", "Fetal heart (/min)", 50, 220)}
        {select("presentation", PRESENTATION, "Presentation", t)}
        {select("urineProtein", URINE_PROTEIN, "Urine protein", t)}
        {n("hb", "Hb (g/dL)", 2, 25, 0.1)}
        {select("syphilis", TEST_RESULT, "Syphilis", t)}
        {select("hiv", TEST_RESULT, "HIV", t)}
        {select("hbsag", TEST_RESULT, "Hepatitis B (HBsAg)", t)}
        {n("ifaTablets", "Iron-folic acid tablets given", 0, 200)}
      </div>
      <fieldset className="grid gap-1 sm:grid-cols-3">
        <legend className="mb-1 text-xs font-semibold text-slate-500">{t("Danger signs")}</legend>
        {Object.entries(DANGER_SIGNS).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="dangerSigns" value={k} />
            {t(label)}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="dewormed" /> {t("Deworming tablet given")}
      </label>
      <input name="note" maxLength={1000} placeholder={t("Note (counselling, birth plan, referral…)")} aria-label={t("Note")} className={inputClass} />
      <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
        {pending ? t("Saving…") : t("Save contact")}
      </button>
    </form>
  );
}

function EndForm({ pregnancyId }: { pregnancyId: string }) {
  const [state, action, pending] = useDone(endPregnancy);
  const t = useT();
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
      <input type="hidden" name="pregnancyId" value={pregnancyId} />
      {state.error && <Alert>{t(state.error)}</Alert>}
      <Field label={t("Outcome")}>
        <select name="outcome" required defaultValue="" className={`${inputClass} w-56`}>
          <option value="" disabled>
            {t("Choose…")}
          </option>
          {Object.entries(OUTCOMES).map(([k, l]) => (
            <option key={k} value={k}>
              {t(l)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Date")}>
        <input name="endedOn" type="date" max={clinicToday()} defaultValue={clinicToday()} className={`${inputClass} w-40`} />
      </Field>
      <button disabled={pending} className={`${buttonClass} px-3 py-1.5 text-xs`}>
        {pending ? t("Saving…") : t("End follow-up")}
      </button>
    </form>
  );
}

"use client";

import { Check, CircleCheck, Cloud, CloudOff, Phone, Server } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useActionState, useState } from "react";
import { Alert, buttonClass, Field, Input, inputClass } from "@/components/ui";
import { etb } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { LEGAL } from "@/lib/legal";
import { inLang } from "@/lib/site-lang";
import { type RequestState, sendRequest } from "./actions";
import { REGIONS, REQUEST } from "./copy";

const DEPLOYMENTS = [
  { value: "CLOUD", icon: Cloud },
  { value: "CLINIC_SERVER", icon: Server },
  { value: "ON_PREMISE", icon: CloudOff },
] as const;

export interface OfferPlan {
  code: string;
  name: string;
  description: string | null;
  priceMonthly: string;
  maxStaff: number | null;
  features: string[];
}

export interface Offer {
  plans: OfferPlan[];
  features: Record<string, string>;
  trialDays: number;
  vatPercent: string;
  support: string | null;
  steps: { title: string; text: string }[];
}

/** A numbered part of the form: the number says how far along the visitor is. */
function Part({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-(--l-line) px-5 py-6 first:border-t-0 sm:px-7">
      <legend className="contents">
        <span className="mb-5 flex items-center gap-3">
          <span className="grid size-7 place-items-center rounded-full bg-(--l-ink) font-mono text-xs font-semibold text-(--l-paper) tabular-nums">{n}</span>
          <span className="text-base font-semibold tracking-tight text-(--l-ink)">{title}</span>
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

const choice =
  "relative flex cursor-pointer gap-3 rounded-xl border border-(--l-line) bg-(--l-paper) p-3.5 text-sm transition-[border-color,background-color,box-shadow] duration-150 hover:border-(--l-accent)/50 has-checked:border-(--l-accent) has-checked:bg-(--l-accent-soft) has-checked:shadow-[0_0_0_1px_var(--l-accent)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-600";
const link = "font-medium text-(--l-accent) underline-offset-4 hover:underline";

/**
 * "We would like to use HMIS": three numbered parts, and beside them (below, on a phone) what the
 * chosen plan includes and what happens after sending. In English or Amharic; what is sent is the
 * same either way.
 */
export function RequestForm({ offer, plan = "", lang = "en" }: { offer: Offer; plan?: string; lang?: Lang }) {
  const t = REQUEST[lang];
  const [state, action, pending] = useActionState<RequestState, FormData>(sendRequest, {});
  const [chosen, setChosen] = useState(plan);
  // The API explains a wrong field in English; in Amharic the form says it in Amharic.
  const err = (name: string) => (state.fields?.[name] ? (t.fieldErrors[name] ?? state.fields[name]) : undefined);
  const error = !state.error
    ? null
    : state.fields && Object.keys(state.fields).length
      ? t.checkFields
      : state.status === 429
        ? (t.tooMany ?? state.error)
        : state.status === 0
          ? (t.unreachable ?? state.error)
          : state.error;
  const selected = offer.plans.find((p) => p.code === chosen);
  const [trialA, trialB, trialC] = t.trial(offer.trialDays);

  if (state.reference) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-(--l-line) bg-(--l-paper) p-8 text-center shadow-(--l-shadow)">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-500/12 text-(--l-ok)">
          <CircleCheck aria-hidden className="size-7" />
        </span>
        <h2 className="land-display mt-5 text-4xl text-(--l-ink)">{t.thanks}</h2>
        <p className="mt-2 text-(--l-muted)">{t.received}</p>
        <p className="mt-4 inline-block rounded-xl bg-(--l-canvas) px-5 py-2.5 font-mono text-2xl font-semibold tracking-wider text-(--l-ink) ring-1 ring-(--l-line)" aria-live="polite">
          {state.reference}
        </p>
        <ol className="mt-8 space-y-3 text-left text-sm">
          {offer.steps.slice(1).map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--l-accent-soft) font-mono text-[11px] font-semibold text-(--l-accent)">{i + 2}</span>
              <span>
                <span className="font-medium text-(--l-ink)">{s.title}.</span> <span className="text-(--l-muted)">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <Link href={inLang(lang, "/welcome")} className={`mt-8 inline-block text-sm ${link}`}>
          {t.back}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form action={action} className="overflow-hidden rounded-2xl border border-(--l-line) bg-(--l-paper) shadow-(--l-shadow)">
        {error && (
          <div className="px-5 pt-5 sm:px-7">
            <Alert>{error}</Alert>
          </div>
        )}
        {/* For robots: people never see or fill this field. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <Part n={1} title={t.clinic}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.name} error={err("clinicName")}>
              <Input name="clinicName" required minLength={2} maxLength={120} autoComplete="organization" />
            </Field>
            <Field label={t.nameAm} error={err("clinicNameAm")}>
              <Input name="clinicNameAm" maxLength={120} lang="am" />
            </Field>
            <Field label={t.type}>
              <select name="type" className={inputClass} defaultValue="CLINIC">
                {(["CLINIC", "HOSPITAL", "PHARMACY"] as const).map((v) => (
                  <option key={v} value={v}>
                    {t.types[v]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.licence} error={err("licenceNumber")}>
              <Input name="licenceNumber" maxLength={60} />
            </Field>
            <Field label={t.region} error={err("region")}>
              <select name="region" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  {t.choose}
                </option>
                {REGIONS.map(([en, am]) => (
                  <option key={en} value={en}>
                    {lang === "am" ? am : en}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.city} error={err("city")}>
              <Input name="city" required minLength={2} maxLength={60} autoComplete="address-level2" />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t.address} error={err("address")}>
                <Input name="address" maxLength={200} placeholder={t.addressHint} autoComplete="street-address" />
              </Field>
            </div>
          </div>
        </Part>

        <Part n={2} title={t.contact}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.fullName} hint={t.fullNameHint} error={err("contactName")}>
              <Input name="contactName" required minLength={2} maxLength={120} autoComplete="name" />
            </Field>
            <Field label={t.mobile} error={err("contactPhone")}>
              <Input name="contactPhone" required inputMode="tel" placeholder="09…" maxLength={20} autoComplete="tel" />
            </Field>
            <Field label={t.email} error={err("contactEmail")}>
              <Input name="contactEmail" type="email" maxLength={200} autoComplete="email" />
            </Field>
            <Field label={t.staff} error={err("staffCount")}>
              <Input name="staffCount" type="number" min={1} max={5000} inputMode="numeric" />
            </Field>
          </div>
        </Part>

        <Part n={3} title={t.want}>
          {offer.plans.length > 0 && (
            <div role="radiogroup" aria-label={t.plan} className="@container">
              <p className="mb-2 text-sm font-medium text-(--l-ink-2)">{t.plan}</p>
              <div className="grid gap-2 @md:grid-cols-2 @2xl:grid-cols-4">
                {[...offer.plans.map((p) => ({ code: p.code, name: p.name, sub: `${etb(p.priceMonthly)} ${t.perMonth}` })), { code: "", name: t.notSure, sub: t.helpChoose }].map((p) => (
                  <label key={p.code || "none"} className={choice}>
                    <input type="radio" name="planCode" value={p.code} checked={chosen === p.code} onChange={() => setChosen(p.code)} className="sr-only" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-(--l-ink)">{p.name}</span>
                      <span className="block font-mono text-xs text-(--l-muted) tabular-nums">{p.sub}</span>
                    </span>
                    {chosen === p.code && <Check aria-hidden className="ml-auto size-4 shrink-0 text-(--l-accent)" />}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div role="radiogroup" aria-label={t.where} className="mt-6 @container">
            <p className="mb-2 text-sm font-medium text-(--l-ink-2)">{t.where}</p>
            <div className="grid gap-2 @2xl:grid-cols-3">
              {DEPLOYMENTS.map((d) => (
                <label key={d.value} className={choice}>
                  <input type="radio" name="deployment" value={d.value} defaultChecked={d.value === "CLOUD"} className="sr-only" />
                  <d.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-(--l-accent)" />
                  <span>
                    <span className="block font-semibold text-(--l-ink)">{t.deployments[d.value][0]}</span>
                    <span className="block text-(--l-muted)">{t.deployments[d.value][1]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <Field label={t.message} error={err("message")}>
              <textarea name="message" rows={3} maxLength={2000} className={`${inputClass} w-full`} placeholder={t.messageHint} />
            </Field>
          </div>
        </Part>

        <div className="flex flex-col gap-4 border-t border-(--l-line) bg-(--l-canvas) px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <label className="flex items-start gap-2.5 text-sm text-(--l-ink-2)">
              {/* Sends the version of the documents the clinic accepted; required to send. */}
              <input type="checkbox" name="termsVersion" value={LEGAL.version} required className="mt-0.5 size-4 shrink-0 accent-brand-700" aria-describedby="terms-note" />
              <span>
                {t.terms[0]}
                <Link href={inLang(lang, "/terms")} target="_blank" className={link}>
                  {t.terms[1]}
                </Link>
                {t.terms[2]}
                <Link href={inLang(lang, "/privacy")} target="_blank" className={link}>
                  {t.terms[3]}
                </Link>
                {t.terms[4]}
              </span>
            </label>
            {state.fields?.termsVersion && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{t.termsError}</p>}
            <p id="terms-note" className="mt-1.5 pl-6.5 text-xs text-(--l-muted)">
              {t.note}
            </p>
          </div>
          <button disabled={pending} className={`${buttonClass} w-full sm:w-auto`}>
            {pending ? t.sending : t.send}
          </button>
        </div>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-24">
        <section aria-label={t.yourPlan} className="rounded-2xl border border-(--l-line) bg-(--l-paper) p-5 shadow-(--l-shadow)">
          <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">{t.yourPlan}</p>
          {selected ? (
            <div key={selected.code} className="enter">
              <p className="land-display mt-2 text-3xl text-(--l-ink)">{selected.name}</p>
              <p className="mt-1 font-mono text-sm text-(--l-ink-2) tabular-nums">
                {etb(selected.priceMonthly)} <span className="text-(--l-muted)">{t.vat(Number(offer.vatPercent))}</span>
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-(--l-ink-2)">
                <li className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--l-ok)" />
                  {selected.maxStaff ? t.staffUpTo(selected.maxStaff) : t.anyStaff}
                </li>
                {selected.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--l-ok)" />
                    {offer.features[f] ?? f}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-sm text-(--l-muted)">{t.notChosen}</p>
          )}
          <p className="mt-4 rounded-lg bg-(--l-accent-soft) px-3 py-2 text-sm text-(--l-ink-2)">
            {trialA}
            <strong className="text-(--l-ink)">{trialB}</strong>
            {trialC}
          </p>
          <Link href={inLang(lang, "/welcome#plans")} className={`mt-3 inline-block text-sm ${link}`}>
            {t.compare}
          </Link>
        </section>

        <section aria-label={t.next} className="rounded-2xl border border-(--l-line) bg-(--l-paper) p-5 shadow-(--l-shadow)">
          <p className="text-xs font-semibold tracking-[0.16em] text-(--l-accent) uppercase">{t.next}</p>
          <ol className="relative mt-4 space-y-4">
            <span aria-hidden className="absolute top-3 bottom-3 left-3 w-px bg-(--l-line)" />
            {offer.steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-3 text-sm">
                <span
                  className={`relative grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold ${i === 0 ? "bg-(--l-ink) text-(--l-paper)" : "bg-(--l-paper) text-(--l-muted) ring-1 ring-(--l-line)"}`}
                >
                  {i + 1}
                </span>
                <span>
                  <span className="block font-medium text-(--l-ink)">{s.title}</span>
                  <span className="block text-(--l-muted)">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          {offer.support && (
            <p className="mt-5 flex items-center gap-2 border-t border-(--l-line) pt-4 text-sm text-(--l-ink-2)">
              <Phone aria-hidden className="size-4 text-(--l-accent)" />
              {t.questions} {offer.support}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

"use client";

import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { Alert, buttonClass, Field, Input, inputClass } from "@/components/ui";
import { type RequestState, sendRequest } from "./actions";

const REGIONS = [
  "Addis Ababa",
  "Afar",
  "Amhara",
  "Benishangul-Gumuz",
  "Central Ethiopia",
  "Dire Dawa",
  "Gambela",
  "Harari",
  "Oromia",
  "Sidama",
  "Somali",
  "South Ethiopia",
  "South West Ethiopia Peoples'",
  "Tigray",
];

const DEPLOYMENTS = [
  { value: "CLOUD", label: "On the HMIS cloud", hint: "Nothing to install: open HMIS in a browser. Needs internet." },
  { value: "CLINIC_SERVER", label: "Our own server, synced to the cloud", hint: "Keeps working when the internet is down." },
  { value: "ON_PREMISE", label: "Our own server only", hint: "Everything stays at the clinic." },
];

export function RequestForm({ plans }: { plans: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(sendRequest, {});
  const err = (name: string) => state.fields?.[name];

  if (state.reference) {
    return (
      <div className="surface p-6 text-center">
        <CircleCheck aria-hidden className="mx-auto size-10 text-emerald-600" />
        <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">Thank you, we have your request</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Your reference is <span className="font-mono font-semibold">{state.reference}</span>. We will call you within two working days to agree on the
          details. After that you receive the first admin&apos;s sign-in and can start the free trial.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      {/* For robots: people never see or fill this field. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">The clinic</legend>
        <Field label="Name" error={err("clinicName")}>
          <Input name="clinicName" required minLength={2} maxLength={120} />
        </Field>
        <Field label="Name in Amharic (optional)" error={err("clinicNameAm")}>
          <Input name="clinicNameAm" maxLength={120} lang="am" />
        </Field>
        <Field label="Type">
          <select name="type" className={inputClass} defaultValue="CLINIC">
            <option value="CLINIC">Clinic</option>
            <option value="HOSPITAL">Hospital</option>
            <option value="PHARMACY">Pharmacy</option>
          </select>
        </Field>
        <Field label="Licence number (optional)" error={err("licenceNumber")}>
          <Input name="licenceNumber" maxLength={60} />
        </Field>
        <Field label="Region" error={err("region")}>
          <select name="region" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {REGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="City or town" error={err("city")}>
          <Input name="city" required minLength={2} maxLength={60} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address (optional)" error={err("address")}>
            <Input name="address" maxLength={200} placeholder="Sub-city, kebele, landmark" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Who to call</legend>
        <Field label="Full name" hint="Usually the person who will run HMIS at the clinic" error={err("contactName")}>
          <Input name="contactName" required minLength={2} maxLength={120} />
        </Field>
        <Field label="Mobile number" error={err("contactPhone")}>
          <Input name="contactPhone" required inputMode="tel" placeholder="09…" maxLength={20} />
        </Field>
        <Field label="Email (optional)" error={err("contactEmail")}>
          <Input name="contactEmail" type="email" maxLength={200} />
        </Field>
        <Field label="Staff who will use HMIS" error={err("staffCount")}>
          <Input name="staffCount" type="number" min={1} max={5000} inputMode="numeric" />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">What you would like</legend>
        {plans.length > 0 && (
          <Field label="Plan">
            <select name="planCode" className={inputClass} defaultValue="">
              <option value="">Not sure yet</option>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Where HMIS runs</p>
          {DEPLOYMENTS.map((d) => (
            <label key={d.value} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/60 dark:border-slate-800 dark:has-[:checked]:bg-brand-950/40">
              <input type="radio" name="deployment" value={d.value} defaultChecked={d.value === "CLOUD"} className="mt-0.5" />
              <span>
                <span className="font-medium text-slate-900 dark:text-white">{d.label}</span>
                <span className="block text-slate-500">{d.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label="Anything else (optional)" error={err("message")}>
          <textarea name="message" rows={3} maxLength={2000} className={inputClass} />
        </Field>
      </fieldset>

      <button disabled={pending} className={`${buttonClass} w-full sm:w-auto`}>
        {pending ? "Sending…" : "Send the request"}
      </button>
    </form>
  );
}

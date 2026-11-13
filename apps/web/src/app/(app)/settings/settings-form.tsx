"use client";

import { useActionState } from "react";
import { saveSettings, type FormState } from "@/app/actions";
import { Toggle } from "@/components/toggle";
import { Alert, buttonClass, Field, Input } from "@/components/ui";
import type { ClinicSettings } from "@/lib/api";

export function SettingsForm({ settings }: { settings: ClinicSettings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, {});
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="max-w-xl space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && !pending && <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>}

      <fieldset className="space-y-4">
        <legend className="mb-2 font-medium">Clinic details</legend>
        <p className="text-sm text-slate-500">Shown on receipts, lab reports and the waiting-room screen.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={err.name}>
            <Input name="name" required defaultValue={settings.name} />
          </Field>
          <Field label="ስም (አማርኛ)" error={err.nameAm}>
            <Input name="nameAm" lang="am" defaultValue={settings.nameAm ?? ""} />
          </Field>
          <Field label="Phone" error={err.phone}>
            <Input name="phone" type="tel" defaultValue={settings.phone ?? ""} />
          </Field>
          <Field label="Address" error={err.address}>
            <Input name="address" defaultValue={settings.address ?? ""} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Payment</legend>
        <Toggle name="requirePrepayment" defaultChecked={settings.requirePrepayment} label="Patients pay before each service">
          The doctor can&apos;t call a patient in until the consultation fee is paid, the lab can&apos;t take a sample until the test is paid, and the pharmacy
          sends drugs to the cashier before dispensing. Credit and insurance patients are not held up. Turn off to bill everything at the end of the visit.
        </Toggle>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Patient registration</legend>
        <Toggle name="doctorsCanRegister" defaultChecked={settings.doctorsCanRegister} label="Doctors can register new patients">
          Receptionists, nurses and admins always can. Turn this on if your clinic has no receptionist, so a doctor can create the patient&apos;s card. Check-in
          (and the consultation fee) still happens at the front desk. Cashiers, the lab and the pharmacy never register patients.
        </Toggle>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Pharmacy stock</legend>
        <Toggle name="multiStore" defaultChecked={settings.multiStore} label="Several stores (main store and dispensary)">
          For clinics that keep stock in a main store and issue it to the pharmacy. Deliveries go into the main store, the pharmacy dispenses only from the
          dispensary, and stock moves between them by transfer (Inventory → Transfers). Turning it on creates a Main store and a Dispensary and puts today&apos;s
          stock in the dispensary, so nothing changes at the counter. Turning it off goes back to one stock; nothing is deleted.
        </Toggle>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Laboratory</legend>
        <div className="max-w-56">
          <Field label="Target for urgent tests (minutes)" error={err.labUrgentMinutes}>
            <Input name="labUrgentMinutes" type="number" min={10} max={1440} step={1} required defaultValue={settings.labUrgentMinutes ?? 60} />
          </Field>
        </div>
        <p className="text-sm text-slate-500">
          From the sample to the released result. Urgent tests go to the top of the lab bench and show as overdue once past this time (or past the test&apos;s
          own target, if that is shorter). Each test&apos;s normal target is set in Settings → Prices.
        </p>
      </fieldset>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

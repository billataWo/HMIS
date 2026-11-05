"use client";

import { useActionState } from "react";
import { saveSettings, type FormState } from "@/app/actions";
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
        <p className="text-sm text-zinc-500">Shown on receipts, lab reports and the waiting-room screen.</p>
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
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="requirePrepayment" defaultChecked={settings.requirePrepayment} className="mt-1" />
          <span>
            <span className="font-medium">Patients pay before each service</span>
            <span className="block text-zinc-500">
              The doctor can&apos;t call a patient in until the consultation fee is paid, the lab can&apos;t take a sample until the test is paid, and the
              pharmacy sends drugs to the cashier before dispensing. Credit and insurance patients are not held up. Untick to bill everything at the end of the visit.
            </span>
          </span>
        </label>
      </fieldset>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

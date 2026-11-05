"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPatient, type FormState } from "../../../actions";
import { Alert, buttonClass, Field, Input, secondaryButtonClass } from "@/components/ui";

export function PatientForm({
  relative,
  defaults,
}: {
  relative?: { id: string; label: string };
  defaults: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPatient, {});
  const v = { ...defaults, ...state.values };
  const err = state.fieldErrors ?? {};
  const [dobMode, setDobMode] = useState<"age" | "date">(v.dateOfBirth ? "date" : "age");

  return (
    <form action={action} className="max-w-2xl space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      {relative && (
        <div className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">
          Family member of {relative.label}
          <input type="hidden" name="relativeId" value={relative.id} />
        </div>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-500">Name (English)</legend>
        <Field label="First name *" error={err.firstName}>
          <Input name="firstName" required defaultValue={v.firstName} autoFocus />
        </Field>
        <Field label="Father's name *" error={err.fatherName}>
          <Input name="fatherName" required defaultValue={v.fatherName} />
        </Field>
        <Field label="Grandfather's name" error={err.grandfather}>
          <Input name="grandfather" defaultValue={v.grandfather} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-500">ስም (አማርኛ)</legend>
        <Field label="ስም" error={err.firstNameAm}>
          <Input name="firstNameAm" lang="am" defaultValue={v.firstNameAm} />
        </Field>
        <Field label="የአባት ስም" error={err.fatherNameAm}>
          <Input name="fatherNameAm" lang="am" defaultValue={v.fatherNameAm} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-500">Details</legend>
        <Field label="Sex *" error={err.sex}>
          <div className="flex gap-4 py-2 text-sm">
            {(["MALE", "FEMALE"] as const).map((s) => (
              <label key={s} className="flex items-center gap-2">
                <input type="radio" name="sex" value={s} required defaultChecked={v.sex === s} />
                {s === "MALE" ? "Male · ወንድ" : "Female · ሴት"}
              </label>
            ))}
          </div>
        </Field>
        <div className="space-y-1 sm:col-span-2">
          <div className="flex gap-3 text-sm">
            <button type="button" onClick={() => setDobMode("age")} className={dobMode === "age" ? "font-semibold" : "text-zinc-500 underline"}>
              Age
            </button>
            <button type="button" onClick={() => setDobMode("date")} className={dobMode === "date" ? "font-semibold" : "text-zinc-500 underline"}>
              Exact date of birth
            </button>
          </div>
          {dobMode === "age" ? (
            <Field label="" error={err.ageYears} hint="Approximate age in years, when the birth date is unknown">
              <Input name="ageYears" type="number" min={0} max={130} defaultValue={v.ageYears} className="max-w-32" />
            </Field>
          ) : (
            <Field label="" error={err.dateOfBirth} hint="Gregorian date">
              <Input name="dateOfBirth" type="date" defaultValue={v.dateOfBirth} className="max-w-48" />
            </Field>
          )}
        </div>
        <Field label="Phone" error={err.phone}>
          <Input name="phone" type="tel" inputMode="tel" placeholder="09XX XXX XXX" defaultValue={v.phone} />
        </Field>
        <Field label="Address" error={err.address}>
          <Input name="address" placeholder="Sub-city, woreda, kebele" defaultValue={v.address} />
        </Field>
        <Field label="Allergies" error={err.allergies} hint="Separate with commas">
          <Input name="allergies" placeholder="e.g. Penicillin" defaultValue={v.allergies} />
        </Field>
      </fieldset>

      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Register patient"}
        </button>
        <Link href="/patients" className={secondaryButtonClass}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPatient, updatePatient, type FormState } from "../../../actions";
import { Alert, buttonClass, Field, Input, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import { REGIONS } from "@/lib/address";
import { ageText, ET_MONTHS, fullName } from "@/lib/format";

/** Registers a patient, or with patientId corrects an existing one (empty fields are cleared). */
export function PatientForm({
  relative,
  defaults,
  patientId,
}: {
  relative?: { id: string; label: string };
  defaults: Record<string, string>;
  patientId?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(patientId ? updatePatient : createPatient, {});
  const v = { ...defaults, ...state.values };
  const err = state.fieldErrors ?? {};
  const [dobMode, setDobMode] = useState<"age" | "date">(v.dateOfBirth || v.ecYear ? "date" : "age");
  // Most patients know their birth date in the Ethiopian calendar; a stored date is Gregorian.
  const [calendar, setCalendar] = useState<"ec" | "gc">(v.dateOfBirth ? "gc" : "ec");

  return (
    <form action={action} className="max-w-2xl space-y-6">
      {state.duplicates?.length ? (
        <Notice tone="warning">
          <p className="font-medium">This patient may already have a card. Check before registering again:</p>
          <ul className="mt-2 space-y-1">
            {state.duplicates.map((d) => {
              const age = ageText(d.dateOfBirth, true);
              return (
                <li key={d.id}>
                  <Link href={`/patients/${d.id}`} className="font-medium underline">
                    {fullName(d)}
                  </Link>{" "}
                  · {d.mrn} · {d.sex === "MALE" ? "M" : "F"}
                  {age !== null && ` · ${age}`}
                  {d.phone && ` · ${d.phone}`}
                </li>
              );
            })}
          </ul>
          <label className="mt-3 flex items-center gap-2 font-medium">
            <input type="checkbox" name="confirmDuplicate" /> This is a different person: register anyway
          </label>
        </Notice>
      ) : (
        state.error && <Alert>{state.error}</Alert>
      )}
      {patientId && <input type="hidden" name="patientId" value={patientId} />}
      {relative && (
        <div className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900 dark:bg-brand-950 dark:text-brand-100">
          Family member of {relative.label}
          <input type="hidden" name="relativeId" value={relative.id} />
        </div>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-500">Name (English)</legend>
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
        <legend className="mb-2 text-sm font-semibold text-slate-500">ስም (አማርኛ)</legend>
        <Field label="ስም" error={err.firstNameAm}>
          <Input name="firstNameAm" lang="am" defaultValue={v.firstNameAm} />
        </Field>
        <Field label="የአባት ስም" error={err.fatherNameAm}>
          <Input name="fatherNameAm" lang="am" defaultValue={v.fatherNameAm} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-500">Details</legend>
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
            <button type="button" onClick={() => setDobMode("age")} className={dobMode === "age" ? "font-semibold" : "text-slate-500 underline"}>
              Age
            </button>
            <button type="button" onClick={() => setDobMode("date")} className={dobMode === "date" ? "font-semibold" : "text-slate-500 underline"}>
              Exact date of birth
            </button>
          </div>
          {dobMode === "age" ? (
            <Field label="" error={err.ageYears ?? err.ageMonths} hint="When the birth date is unknown. For a baby or young child, give the months too.">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Input name="ageYears" type="number" min={0} max={130} defaultValue={v.ageYears} aria-label="Years" className="w-24" />
                <span>years</span>
                <Input name="ageMonths" type="number" min={0} max={11} defaultValue={v.ageMonths} aria-label="Months" className="w-20" />
                <span>months</span>
              </div>
            </Field>
          ) : (
            <Field label="" error={err.dateOfBirthEc ?? err.dateOfBirth} hint={calendar === "ec" ? "Ethiopian calendar (ዓ.ም.)" : "Gregorian calendar"}>
              <div className="space-y-2">
                <div className="flex gap-3 text-xs">
                  <button type="button" onClick={() => setCalendar("ec")} className={calendar === "ec" ? "font-semibold" : "text-slate-500 underline"}>
                    Ethiopian · ዓ.ም.
                  </button>
                  <button type="button" onClick={() => setCalendar("gc")} className={calendar === "gc" ? "font-semibold" : "text-slate-500 underline"}>
                    Gregorian
                  </button>
                </div>
                {calendar === "ec" ? (
                  <div className="flex flex-wrap gap-2">
                    <Input name="ecDay" type="number" min={1} max={30} placeholder="Day" aria-label="Day" defaultValue={v.ecDay} className="w-20" />
                    <select name="ecMonth" aria-label="Month" defaultValue={v.ecMonth ?? ""} className={`${inputClass} w-40`}>
                      <option value="">Month</option>
                      {ET_MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {i + 1}. {m}
                        </option>
                      ))}
                    </select>
                    <Input name="ecYear" type="number" min={1900} max={2100} placeholder="Year" aria-label="Year" defaultValue={v.ecYear} className="w-24" />
                  </div>
                ) : (
                  <Input name="dateOfBirth" type="date" defaultValue={v.dateOfBirth} className="max-w-48" />
                )}
              </div>
            </Field>
          )}
        </div>
        <Field label="Phone" error={err.phone}>
          <Input name="phone" type="tel" inputMode="tel" placeholder="09XX XXX XXX" defaultValue={v.phone} />
        </Field>
        <Field label="National ID (Fayda)" error={err.nationalId} hint="12 or 16 digits">
          <Input name="nationalId" inputMode="numeric" defaultValue={v.nationalId} />
        </Field>
        <Field label="Allergies" error={err.allergies} hint="Separate with commas">
          <Input name="allergies" placeholder="e.g. Penicillin" defaultValue={v.allergies} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-500">Address · አድራሻ</legend>
        <Field label="Region" error={err.region}>
          <select name="region" defaultValue={v.region ?? ""} className={inputClass}>
            <option value="">—</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Zone or sub-city" error={err.zone}>
          <Input name="zone" defaultValue={v.zone} />
        </Field>
        <Field label="Woreda" error={err.woreda}>
          <Input name="woreda" defaultValue={v.woreda} />
        </Field>
        <Field label="Kebele" error={err.kebele}>
          <Input name="kebele" defaultValue={v.kebele} />
        </Field>
        <Field label="House number" error={err.houseNo}>
          <Input name="houseNo" defaultValue={v.houseNo} />
        </Field>
        <Field label="Other details" error={err.address}>
          <Input name="address" placeholder="e.g. near the church" defaultValue={v.address} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-500">Next of kin · የቅርብ ዘመድ</legend>
        <Field label="Name" error={err.nextOfKinName}>
          <Input name="nextOfKinName" defaultValue={v.nextOfKinName} />
        </Field>
        <Field label="Relation" error={err.nextOfKinRelation}>
          <Input name="nextOfKinRelation" placeholder="e.g. mother, husband" defaultValue={v.nextOfKinRelation} />
        </Field>
        <Field label="Phone" error={err.nextOfKinPhone}>
          <Input name="nextOfKinPhone" type="tel" inputMode="tel" placeholder="09XX XXX XXX" defaultValue={v.nextOfKinPhone} />
        </Field>
      </fieldset>

      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : patientId ? "Save changes" : "Register patient"}
        </button>
        <Link href={patientId ? `/patients/${patientId}` : "/patients"} className={secondaryButtonClass}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

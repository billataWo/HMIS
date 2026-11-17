"use client";

import { useActionState } from "react";
import { createUser, type FormState } from "../../actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input, inputClass } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/format";

export function UserForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createUser, {});
  const v = state.values ?? {};
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m])) as typeof fe;

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{t(state.error)}</Alert>}
      <Field label={t("Full name")} error={err.fullName}>
        <Input name="fullName" required defaultValue={v.fullName} />
      </Field>
      <Field label={t("Phone (used to sign in)")} error={err.phone}>
        <Input name="phone" type="tel" required placeholder="09XX XXX XXX" defaultValue={v.phone} />
      </Field>
      <Field label={t("Role")} error={err.role}>
        <select name="role" required defaultValue={v.role ?? ""} className={inputClass}>
          <option value="" disabled>
            {t("Choose a role")}
          </option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Room (optional)")} error={err.room} hint={t("Where they see patients, e.g. Room 2. Shown on the waiting-room screen.")}>
        <Input name="room" maxLength={40} placeholder={t("Room 2")} defaultValue={v.room} />
      </Field>
      <Field label={t("Temporary password")} error={err.password} hint={t("At least 8 characters")}>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? t("Saving…") : t("Add staff member")}
      </button>
    </form>
  );
}

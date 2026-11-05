"use client";

import { useActionState } from "react";
import { createUser, type FormState } from "../../actions";
import { Alert, buttonClass, Field, Input, inputClass } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/format";

export function UserForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createUser, {});
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Full name" error={err.fullName}>
        <Input name="fullName" required defaultValue={v.fullName} />
      </Field>
      <Field label="Phone (used to sign in)" error={err.phone}>
        <Input name="phone" type="tel" required placeholder="09XX XXX XXX" defaultValue={v.phone} />
      </Field>
      <Field label="Role" error={err.role}>
        <select name="role" required defaultValue={v.role ?? ""} className={inputClass}>
          <option value="" disabled>
            Choose a role
          </option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Temporary password" error={err.password} hint="At least 8 characters">
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Saving…" : "Add staff member"}
      </button>
    </form>
  );
}

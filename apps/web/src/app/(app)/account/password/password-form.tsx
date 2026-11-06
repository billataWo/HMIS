"use client";

import { useActionState } from "react";
import { changePassword, type FormState } from "@/app/actions";
import { Alert, buttonClass, Field, Input } from "@/components/ui";

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="surface space-y-4 p-5">
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Current password" error={err.current}>
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" error={err.next} hint="At least 8 characters. A short sentence is easy to remember and hard to guess.">
        <Input name="next" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="New password again" error={err.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

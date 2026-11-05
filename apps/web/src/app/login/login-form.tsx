"use client";

import { useActionState } from "react";
import { login, type FormState } from "../actions";
import { Alert, buttonClass, Field, Input } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Phone number">
        <Input name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="09XX XXX XXX" defaultValue={state.values?.phone} />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

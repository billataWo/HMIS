"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { login, type FormState } from "../actions";
import { Alert, buttonClass, Field, Input } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useT } from "@/components/lang-provider";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  const t = useT();
  return (
    <form action={action} className="space-y-5">
      <Reveal show={!!state.error}>
        <Alert>{state.error && t(state.error)}</Alert>
      </Reveal>
      <Field label={t("Phone number")}>
        <Input name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="09XX XXX XXX" defaultValue={state.values?.phone} className="h-11" />
      </Field>
      <Field label={t("Password")}>
        <Input name="password" type="password" autoComplete="current-password" required className="h-11" />
      </Field>
      <button type="submit" disabled={pending} className={`${buttonClass} h-11 w-full`}>
        {pending && <LoaderCircle aria-hidden className="animate-spin" />}
        {pending ? t("Signing in…") : t("Sign in")}
      </button>
    </form>
  );
}

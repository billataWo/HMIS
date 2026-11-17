"use client";

import { useActionState } from "react";
import { changePassword, type FormState } from "@/app/actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Field, Input } from "@/components/ui";

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  const err = state.fieldErrors ?? {};
  const t = useT();
  const e = (k: string) => (err[k] ? t(err[k]) : undefined);
  return (
    <form action={action} className="surface space-y-4 p-5">
      {state.error && <Alert>{t(state.error)}</Alert>}
      <Field label={t("Current password")} error={e("current")}>
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={t("New password")} error={e("next")} hint={t("At least 8 characters. A short sentence is easy to remember and hard to guess.")}>
        <Input name="next" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label={t("New password again")} error={e("confirm")}>
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? t("Saving…") : t("Change password")}
      </button>
    </form>
  );
}

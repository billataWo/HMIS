"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Reveal } from "@/components/motion";
import { Alert, buttonClass, Field, Input, linkClass } from "@/components/ui";
import { type TwoStepState, verifyTwoStep } from "../../two-step-actions";

export function TwoStepForm() {
  const [state, action, pending] = useActionState<TwoStepState, FormData>(verifyTwoStep, {});
  return (
    <form action={action} className="space-y-5">
      <Reveal show={!!state.error}>
        <Alert>
          {state.error}{" "}
          {state.expired && (
            <Link href="/login" className={linkClass}>
              Sign in again
            </Link>
          )}
        </Alert>
      </Reveal>
      <Field label="Code">
        <Input
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={12}
          placeholder="123 456"
          className="h-11 text-center font-mono text-lg tracking-widest"
        />
      </Field>
      <button type="submit" disabled={pending} className={`${buttonClass} h-11 w-full`}>
        {pending && <LoaderCircle aria-hidden className="animate-spin" />}
        {pending ? "Checking…" : "Continue"}
      </button>
      <p className="text-center text-sm">
        <Link href="/login" className={linkClass}>
          Back to sign-in
        </Link>
      </p>
    </form>
  );
}

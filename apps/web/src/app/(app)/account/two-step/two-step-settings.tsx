"use client";

import { Copy, Printer, Smartphone } from "lucide-react";
import { useActionState, useState } from "react";
import { type CodesState, disableTwoStep, enableTwoStep, renewRecoveryCodes, type SetupState, startTwoStepSetup } from "@/app/two-step-actions";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, Card, Field, Input, secondaryButtonClass } from "@/components/ui";

/** Set up, renew codes, move to a new phone, or (not for admins) switch off. */
export function TwoStepSettings({ enabled, required, recoveryCodesLeft }: { enabled: boolean; required: boolean; recoveryCodesLeft: number }) {
  const [setup, startSetup, starting] = useActionState<SetupState, FormData>(startTwoStepSetup, {});
  const [enable, confirm, confirming] = useActionState<CodesState, FormData>(enableTwoStep, {});
  const [renew, renewCodes, renewing] = useActionState<CodesState, FormData>(renewRecoveryCodes, {});
  const [off, switchOff, switching] = useActionState<{ error?: string }, FormData>(disableTwoStep, {});
  const [moving, setMoving] = useState(false);
  const t = useT();

  // Just turned on (or renewed): the recovery codes, shown this once.
  const codes = enable.recoveryCodes ?? renew.recoveryCodes;
  if (codes) return <RecoveryCodes codes={codes} justEnabled={!!enable.recoveryCodes} />;

  // Adding the app: scan the QR code, type the first code.
  if (setup.qr && setup.secret) {
    return (
      <Card title={t("Scan this with your authenticator app")}>
        <div className="flex flex-wrap items-start gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline data image, nothing to optimise */}
          <img src={setup.qr} alt={t("QR code for the authenticator app")} width={200} height={200} className="rounded-lg bg-white p-2" />
          <div className="min-w-0 flex-1 basis-60 space-y-3 text-sm text-slate-600 dark:text-slate-400">
            <p>
              {t.rich("Use {google}, {microsoft} or any similar app: tap “+”, then scan the code.", {
                google: <strong>Google Authenticator</strong>,
                microsoft: <strong>Microsoft Authenticator</strong>,
              })}
            </p>
            <p>
              {t("Can't scan? Choose “enter a setup key” and type:")}
              <span className="mt-1 block font-mono text-base tracking-wider break-all text-slate-900 dark:text-white">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span>
            </p>
            <form action={confirm} className="space-y-3 pt-2">
              {enable.error && <Alert>{t(enable.error)}</Alert>}
              <Field label={t("Then enter the 6-digit code the app shows")}>
                <Input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="w-40 text-center font-mono text-lg tracking-widest" />
              </Field>
              <button disabled={confirming} className={buttonClass}>
                {confirming ? t("Checking…") : t("Turn on two-step sign-in")}
              </button>
            </form>
          </div>
        </div>
      </Card>
    );
  }

  if (!enabled || moving) {
    return (
      <Card title={t(moving ? "Move to a new phone" : "Set up two-step sign-in")}>
        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
          <p className="flex items-start gap-2">
            <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("After your password, HMIS will ask for a 6-digit code from an app on your phone. Someone who learns your password still cannot sign in. The app works without internet.")}
          </p>
          <form action={startSetup} className="space-y-3">
            {setup.error && <Alert>{t(setup.error)}</Alert>}
            {moving && (
              <Field label={t("Your password")}>
                <Input name="password" type="password" required autoComplete="current-password" className="max-w-xs" />
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <button disabled={starting} className={buttonClass}>
                {starting ? t("Preparing…") : t("Show the QR code")}
              </button>
              {moving && (
                <button type="button" onClick={() => setMoving(false)} className={secondaryButtonClass}>
                  {t("Back")}
                </button>
              )}
            </div>
          </form>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={t("Recovery codes")} description={t("For a lost phone: each works once. {n} left.", { n: recoveryCodesLeft })}>
        <form action={renewCodes} className="space-y-3">
          {renew.error && <Alert>{t(renew.error)}</Alert>}
          <Field label={t("Code from your app")}>
            <Input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="w-40 font-mono tracking-widest" />
          </Field>
          <button disabled={renewing} className={secondaryButtonClass}>
            {t("Make new recovery codes")}
          </button>
        </form>
      </Card>
      <Card title={t("New phone")}>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t("Moving to a new phone replaces the app on the old one.")}</p>
        <button onClick={() => setMoving(true)} className={secondaryButtonClass}>
          {t("Move to a new phone")}
        </button>
      </Card>
      {!required && (
        <Card title={t("Switch off")} className="md:col-span-2">
          <form action={switchOff} className="flex flex-wrap items-end gap-3">
            {off.error && <Alert>{t(off.error)}</Alert>}
            <Field label={t("Your password")}>
              <Input name="password" type="password" required autoComplete="current-password" className="w-60" />
            </Field>
            <button disabled={switching} className={secondaryButtonClass}>
              {t("Switch off two-step sign-in")}
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}

function RecoveryCodes({ codes, justEnabled }: { codes: string[]; justEnabled: boolean }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <Card title={t(justEnabled ? "Two-step sign-in is on. Keep these recovery codes" : "Your new recovery codes")}>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        {t("If you lose your phone, each of these lets you sign in once. They are shown only now: print them or write them down, and keep them somewhere safe (not on the phone).")}{" "}
        {t(justEnabled ? "Your other sign-ins have ended." : "The old codes no longer work.")}
      </p>
      <ol className="grid grid-cols-2 gap-2 font-mono text-lg tracking-wider text-slate-900 sm:grid-cols-5 dark:text-white">
        {codes.map((c) => (
          <li key={c} className="rounded-lg bg-slate-100 px-3 py-2 text-center dark:bg-slate-800">
            {c}
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2 print:hidden">
        <button onClick={() => window.print()} className={secondaryButtonClass}>
          <Printer aria-hidden className="size-4" /> {t("Print")}
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true));
          }}
          className={secondaryButtonClass}
        >
          <Copy aria-hidden className="size-4" /> {copied ? t("Copied") : t("Copy")}
        </button>
        {/* A full page load: the router still remembers "/" as a redirect to this setup page. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className={buttonClass}>
          {t("I have saved them")}
        </a>
      </div>
    </Card>
  );
}

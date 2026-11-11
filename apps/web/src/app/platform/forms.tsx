"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert, buttonClass, dangerButtonClass, dangerQuietButtonClass, Field, Input, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { ClinicDetail, OperatorRow, Plan, PlatformSettings } from "@/lib/platform";
import {
  addOperator,
  approveRequest,
  type ApproveState,
  changeOperatorPassword,
  clinicAction,
  enableOperatorTwoStep,
  type FormState,
  deleteClinicData,
  issueInvoice,
  licenceFile,
  type OperatorState,
  platformCode,
  platformLogin,
  recordPayment,
  rejectRequest,
  reviewPayment,
  savePlan,
  saveSettings,
  type SetupState,
  startOperatorTwoStep,
  updateOperator,
  updateSubscription,
  voidInvoice,
} from "./actions";

function Result({ state }: { state: FormState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.message) return <Notice tone="success">{state.message}</Notice>;
  return null;
}

const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

// ─── Signing in ─────────────────────────────────────────────────────────────────────────────────
export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(platformLogin, {});
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="username" autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      <button disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function CodeForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(platformCode, {});
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <Field label="Code" hint="6 digits from the authenticator app, or a recovery code">
        <Input name="code" required autoComplete="one-time-code" inputMode="text" autoFocus maxLength={20} className={`${inputClass} text-center font-mono tracking-widest`} />
      </Field>
      <button disabled={pending} className={`${buttonClass} w-full`}>
        Continue
      </button>
    </form>
  );
}

// ─── Own account ────────────────────────────────────────────────────────────────────────────────
export function PasswordForm({ temporary }: { temporary: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changeOperatorPassword, {});
  return (
    <form action={action} className="space-y-3">
      <Result state={state} />
      <Field label={temporary ? "Temporary password" : "Current password"}>
        <Input name="current" type="password" required autoComplete="current-password" />
      </Field>
      <Field label="New password" hint="At least 12 characters">
        <Input name="next" type="password" required minLength={12} autoComplete="new-password" />
      </Field>
      <Field label="New password again">
        <Input name="confirm" type="password" required minLength={12} autoComplete="new-password" />
      </Field>
      <button disabled={pending} className={buttonClass}>
        Change password
      </button>
    </form>
  );
}

export function TwoStepSetup({ enabled }: { enabled: boolean }) {
  const [setup, start, starting] = useActionState<SetupState, FormData>(startOperatorTwoStep, {});
  const [done, enable, enabling] = useActionState<SetupState, FormData>(enableOperatorTwoStep, {});
  if (done.recoveryCodes) {
    return (
      <div className="space-y-3">
        <Notice tone="success">Two-step sign-in is on. Keep these recovery codes somewhere safe (not on the phone): each lets you sign in once.</Notice>
        <ol className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
          {done.recoveryCodes.map((c) => (
            <li key={c} className="rounded-md bg-slate-100 px-2 py-1.5 text-center dark:bg-slate-800">
              {c}
            </li>
          ))}
        </ol>
        <a href="/platform" className={buttonClass}>
          I have saved them
        </a>
      </div>
    );
  }
  if (!setup.secret) {
    return (
      <form action={start} className="space-y-3">
        <Result state={setup} />
        {enabled && (
          <Field label="Password" hint="To move two-step sign-in to another phone">
            <Input name="password" type="password" required autoComplete="current-password" />
          </Field>
        )}
        <button disabled={starting} className={enabled ? secondaryButtonClass : buttonClass}>
          {enabled ? "Move to another phone" : "Set up two-step sign-in"}
        </button>
      </form>
    );
  }
  return (
    <form action={enable} className="space-y-3">
      <Result state={done} />
      <p className="text-sm text-slate-600 dark:text-slate-300">Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator…), then enter the code it shows.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code for the authenticator app" width={220} height={220} className="rounded-lg bg-white p-2" />
      <p className="text-xs text-slate-500">
        Or type this key: <span className="font-mono">{setup.secret?.match(/.{1,4}/g)?.join(" ")}</span>
      </p>
      <Field label="Code from the app">
        <Input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" className={`${inputClass} w-40 font-mono tracking-widest`} />
      </Field>
      <button disabled={enabling} className={buttonClass}>
        Turn on two-step sign-in
      </button>
    </form>
  );
}

// ─── Requests ───────────────────────────────────────────────────────────────────────────────────
export function ApproveForm({ id, plans, defaults }: { id: string; plans: Plan[]; defaults: { planCode: string | null; deployment: string; trialDays: number; clinicName: string; adminName: string; adminPhone: string } }) {
  const [state, action, pending] = useActionState<ApproveState, FormData>(approveRequest.bind(null, id), {});
  if (state.approved) {
    const a = state.approved;
    return (
      <div className="space-y-3">
        <Notice tone="success">{a.clinicName} is created and its free trial has started.</Notice>
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm dark:border-brand-900 dark:bg-brand-950/50">
          <p>Give the first admin these, in person or by phone (the password is shown only now):</p>
          <p className="mt-2">
            Phone: <span className="font-mono font-semibold">{a.adminPhone}</span>
          </p>
          <p>
            Temporary password: <span className="font-mono text-lg font-semibold">{a.temporaryPassword}</span>
          </p>
          <p className="mt-2 text-slate-500">At the first sign-in they choose a password and set up two-step sign-in.</p>
        </div>
        <a href={`/platform/clinics/${a.tenantId}`} className={buttonClass}>
          Open the clinic
        </a>
      </div>
    );
  }
  return (
    <form action={action} className="@container space-y-3">
      <Result state={state} />
      <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
        <Field label="Plan">
          <select name="planCode" required className={`${inputClass} w-full`} defaultValue={defaults.planCode ?? plans[0]?.code}>
            {plans.map((p) => (
              <option key={p.id} value={p.code}>
                {p.name}
                {!p.active ? " (not offered)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Runs on">
          <select name="deployment" className={`${inputClass} w-full`} defaultValue={defaults.deployment}>
            <option value="CLOUD">HMIS cloud</option>
            <option value="CLINIC_SERVER">Clinic server + cloud</option>
            <option value="ON_PREMISE">Own server only</option>
          </select>
        </Field>
        <Field label="Free trial (days)">
          <Input name="trialDays" type="number" min={0} max={365} required defaultValue={defaults.trialDays} className="w-full" />
        </Field>
      </div>
      <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
        <Field label="Clinic name">
          <Input name="clinicName" required defaultValue={defaults.clinicName} className="w-full" />
        </Field>
        <Field label="First admin">
          <Input name="adminName" required defaultValue={defaults.adminName} className="w-full" />
        </Field>
        <Field label="Admin's mobile">
          <Input name="adminPhone" required defaultValue={defaults.adminPhone} className="w-full" inputMode="tel" />
        </Field>
      </div>
      <button disabled={pending} className={`${buttonClass} w-full @2xl:w-auto`}>
        {pending ? "Creating the clinic…" : "Approve and create the clinic"}
      </button>
    </form>
  );
}

/** A form with only a reason, e.g. reject, suspend, cancel, void. */
export function ReasonForm({ action: run, label, placeholder, danger }: { action: (prev: FormState, form: FormData) => Promise<FormState>; label: string; placeholder: string; danger?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(run, {});
  const [open, setOpen] = useState(false);
  if (state.ok) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={danger ? dangerQuietButtonClass : secondaryButtonClass}>
        {label}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <Result state={state} />
      <Input name="reason" required minLength={3} maxLength={500} placeholder={placeholder} className={`${inputClass} min-w-56 flex-1`} autoFocus />
      <button disabled={pending} className={danger ? dangerButtonClass : buttonClass}>
        {label}
      </button>
      <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
        Back
      </button>
    </form>
  );
}

export function RejectRequest({ id }: { id: string }) {
  return <ReasonForm action={rejectRequest.bind(null, id)} label="Reject" placeholder="Why (kept with the request)" danger />;
}

// ─── A clinic ───────────────────────────────────────────────────────────────────────────────────
export function SubscriptionForm({ tenantId, sub, plans }: { tenantId: string; sub: ClinicDetail["subscription"]; plans: Plan[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateSubscription.bind(null, tenantId), {});
  return (
    <form action={action} className="space-y-3">
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Plan">
          <select name="planId" required className={inputClass} defaultValue={sub?.planId ?? ""}>
            {!sub && (
              <option value="" disabled>
                Choose…
              </option>
            )}
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Billed">
          <select name="billingCycle" className={inputClass} defaultValue={sub?.billingCycle ?? "MONTHLY"}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </Field>
        <Field label="Runs on">
          <select name="deployment" className={inputClass} defaultValue={sub?.deployment ?? "CLOUD"}>
            <option value="CLOUD">HMIS cloud</option>
            <option value="CLINIC_SERVER">Clinic server + cloud</option>
            <option value="ON_PREMISE">Own server only</option>
          </select>
        </Field>
      </div>
      {sub && (
        <div className="grid gap-3 sm:grid-cols-3">
          {sub.status === "TRIAL" ? (
            <Field label="Trial ends" hint="Extend a trial here">
              <Input name="trialEndsAt" type="date" defaultValue={dateInput(sub.trialEndsAt)} />
            </Field>
          ) : (
            <Field label="Paid until" hint="Empty: no end date (free)">
              <Input name="paidUntil" type="date" defaultValue={dateInput(sub.paidUntil)} />
            </Field>
          )}
          <Field label="Grace days" hint="Working, with warnings, after the end">
            <Input name="graceDays" type="number" min={0} max={90} defaultValue={sub.graceDays} />
          </Field>
        </div>
      )}
      <Field label="Notes (HMIS only)">
        <textarea name="notes" rows={2} maxLength={2000} className={inputClass} defaultValue={sub?.notes ?? ""} />
      </Field>
      <button disabled={pending} className={buttonClass}>
        {sub ? "Save" : "Start billing this clinic"}
      </button>
    </form>
  );
}

export function ClinicActions({ tenantId, state }: { tenantId: string; state: string }) {
  const [reactivated, reactivate, pending] = useActionState<FormState, FormData>(clinicAction.bind(null, tenantId, "reactivate"), {});
  return (
    <div className="flex flex-wrap items-start gap-2">
      {state === "suspended" || state === "cancelled" ? (
        <form action={reactivate}>
          <Result state={reactivated} />
          <button disabled={pending} className={buttonClass}>
            Reactivate
          </button>
        </form>
      ) : (
        <ReasonForm action={clinicAction.bind(null, tenantId, "suspend")} label="Suspend (read-only)" placeholder="Why" danger />
      )}
      {state !== "cancelled" && <ReasonForm action={clinicAction.bind(null, tenantId, "cancel")} label="Cancel the subscription" placeholder="Why" danger />}
    </div>
  );
}

export function IssueInvoice({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Result state={state} />
      <button type="button" disabled={pending} onClick={() => start(async () => setState(await issueInvoice(tenantId)))} className={buttonClass}>
        Issue the next invoice
      </button>
    </div>
  );
}

/** Saves the clinic's licence file, to send to an own-server install. */
export function DownloadLicence({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const download = () =>
    start(async () => {
      const r = await licenceFile(tenantId);
      if (!r.licence || !r.filename) return setState({ error: r.error ?? "Could not issue the licence." });
      const url = URL.createObjectURL(new Blob([`${r.licence}\n`], { type: "text/plain" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: r.filename });
      a.click();
      URL.revokeObjectURL(url);
      setState({ message: `Saved ${r.filename}: valid until ${r.endsAt?.slice(0, 10)} plus the grace period.` });
    });
  return (
    <div className="space-y-2">
      <Result state={state} />
      <button type="button" disabled={pending} onClick={download} className={secondaryButtonClass}>
        Download the licence file
      </button>
    </div>
  );
}

/** Owners only: deletes a cancelled clinic's records, after typing its name. */
export function DeleteClinicData({ tenantId, name }: { tenantId: string; name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteClinicData.bind(null, tenantId), {});
  const [open, setOpen] = useState(false);
  if (state.ok) return <Notice tone="success">{state.message}</Notice>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={dangerQuietButtonClass}>
        Delete the clinic&apos;s records
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <Result state={state} />
      <Field label={`Type ${name} to confirm`} hint="Every patient, visit, bill and staff account of this clinic is deleted for good. HMIS's invoices stay.">
        <Input name="confirmName" required autoComplete="off" />
      </Field>
      <div className="flex gap-2">
        <button disabled={pending} className={dangerButtonClass}>
          {pending ? "Deleting…" : "Delete for good"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          Back
        </button>
      </div>
    </form>
  );
}

export function InvoiceActions({ invoiceId, balance, today }: { invoiceId: string; balance: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordPayment.bind(null, invoiceId), {});
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Result state={state} />
      {open ? (
        <form action={action} className="grid gap-2 sm:grid-cols-5 sm:items-end">
          <Field label="Amount">
            <Input name="amount" required defaultValue={balance} inputMode="decimal" />
          </Field>
          <Field label="How">
            <select name="method" className={inputClass} defaultValue="BANK_TRANSFER">
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CASH">Cash</option>
              <option value="CHAPA">Chapa</option>
              <option value="TELEBIRR">Telebirr</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Reference">
            <Input name="reference" maxLength={100} />
          </Field>
          <Field label="Paid on">
            <Input name="paidAt" type="date" required defaultValue={today} max={today} />
          </Field>
          <button disabled={pending} className={buttonClass}>
            Record
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
            Record a payment
          </button>
          <ReasonForm action={voidInvoice.bind(null, invoiceId)} label="Void" placeholder="Why" />
        </div>
      )}
    </div>
  );
}

export function PaymentReview({ paymentId }: { paymentId: string }) {
  const [state, confirm, pending] = useActionState<FormState, FormData>(reviewPayment.bind(null, paymentId, "confirm"), {});
  if (state.ok) return <span className="text-sm text-emerald-700">Confirmed</span>;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <form action={confirm}>
        <Result state={state} />
        <button disabled={pending} className={buttonClass}>
          Confirm: money received
        </button>
      </form>
      <ReasonForm action={reviewPayment.bind(null, paymentId, "reject")} label="Not received" placeholder="e.g. no such transfer on the statement" />
    </div>
  );
}

// ─── Plans, operators, settings ─────────────────────────────────────────────────────────────────
export function PlanForm({ plan, features }: { plan: Plan | null; features: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePlan.bind(null, plan?.id ?? null), {});
  return (
    <form action={action} className="space-y-3">
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Code">
          <Input name="code" required defaultValue={plan?.code} pattern="[A-Za-z0-9_]{2,20}" />
        </Field>
        <Field label="Name">
          <Input name="name" required defaultValue={plan?.name} />
        </Field>
        <Field label="ETB / month">
          <Input name="priceMonthly" required inputMode="decimal" defaultValue={plan ? Number(plan.priceMonthly) : ""} />
        </Field>
        <Field label="ETB / year">
          <Input name="priceYearly" required inputMode="decimal" defaultValue={plan ? Number(plan.priceYearly) : ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Staff accounts" hint="Empty: no limit">
          <Input name="maxStaff" type="number" min={1} defaultValue={plan?.maxStaff ?? ""} />
        </Field>
        <Field label="Order">
          <Input name="sortOrder" type="number" min={0} defaultValue={plan?.sortOrder ?? 0} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Input name="description" maxLength={500} defaultValue={plan?.description ?? ""} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {Object.entries(features).map(([code, name]) => (
          <label key={code} className="flex items-center gap-2">
            <input type="checkbox" name="features" value={code} defaultChecked={plan?.features.includes(code)} /> {name}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={plan?.active ?? true} /> Offered to new clinics
        </label>
      </div>
      <button disabled={pending} className={buttonClass}>
        {plan ? "Save" : "Add the plan"}
      </button>
    </form>
  );
}

export function AddOperatorForm() {
  const [state, action, pending] = useActionState<OperatorState, FormData>(addOperator, {});
  return (
    <form action={action} className="space-y-3">
      <Result state={state} />
      {state.temporaryPassword && (
        <Notice tone="success">
          {state.email}: temporary password <span className="font-mono font-semibold">{state.temporaryPassword}</span> (shown only now).
        </Notice>
      )}
      <Field label="Full name">
        <Input name="fullName" required minLength={2} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required />
      </Field>
      <Field label="Role">
        <select name="role" className={inputClass} defaultValue="SUPPORT">
          <option value="SUPPORT">Support: requests and clinics</option>
          <option value="BILLING">Billing: also subscriptions, invoices, payments</option>
          <option value="OWNER">Owner: everything</option>
        </select>
      </Field>
      <button disabled={pending} className={buttonClass}>
        Add
      </button>
    </form>
  );
}

export function OperatorActions({ op, self }: { op: OperatorRow; self: boolean }) {
  const [state, setState] = useState<OperatorState>({});
  const [pending, start] = useTransition();
  const run = (change: Record<string, unknown>) => start(async () => setState(await updateOperator(op.id, change)));
  return (
    <div className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      {state.temporaryPassword && (
        <Notice tone="success">
          Temporary password <span className="font-mono font-semibold">{state.temporaryPassword}</span> (shown only now).
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Role"
          disabled={pending || self}
          defaultValue={op.role}
          onChange={(e) => run({ role: e.target.value })}
          className={`${inputClass} w-auto`}
        >
          <option value="SUPPORT">Support</option>
          <option value="BILLING">Billing</option>
          <option value="OWNER">Owner</option>
        </select>
        <button type="button" disabled={pending} onClick={() => run({ resetPassword: true })} className={secondaryButtonClass}>
          New password
        </button>
        <button type="button" disabled={pending} onClick={() => run({ resetTwoStep: true })} className={secondaryButtonClass}>
          Reset two-step
        </button>
        {!self && (
          <button type="button" disabled={pending} onClick={() => run({ active: !op.active })} className={op.active ? dangerQuietButtonClass : buttonClass}>
            {op.active ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, {});
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Free trial (days)">
          <Input name="trialDays" type="number" min={0} max={365} required defaultValue={settings.trialDays} />
        </Field>
        <Field label="Grace period (days)" hint="After the end, before read-only">
          <Input name="graceDays" type="number" min={0} max={90} required defaultValue={settings.graceDays} />
        </Field>
        <Field label="VAT (%)">
          <Input name="vatPercent" type="number" step="0.01" min={0} max={50} required defaultValue={Number(settings.vatPercent)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="autoInvoice" defaultChecked={settings.autoInvoice} /> Issue renewal invoices automatically
        </label>
        <Field label="Days before the end">
          <Input name="invoiceDaysBefore" type="number" min={1} max={60} required defaultValue={settings.invoiceDaysBefore} />
        </Field>
      </div>
      <Field label="Days a cancelled clinic has to export its records" hint="Its records can be deleted after that (at least 30)">
        <Input name="dataRetentionDays" type="number" min={30} max={3650} required defaultValue={settings.dataRetentionDays} />
      </Field>
      <Field label="Bank details for clinics" hint="Bank, account name and number, shown on every open invoice">
        <textarea name="bankDetails" rows={4} maxLength={2000} className={inputClass} defaultValue={settings.bankDetails ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Support phone">
          <Input name="supportPhone" maxLength={40} defaultValue={settings.supportPhone ?? ""} />
        </Field>
        <Field label="Support email">
          <Input name="supportEmail" type="email" maxLength={200} defaultValue={settings.supportEmail ?? ""} />
        </Field>
      </div>
      <button disabled={pending} className={buttonClass}>
        Save
      </button>
    </form>
  );
}

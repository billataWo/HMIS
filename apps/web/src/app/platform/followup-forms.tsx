"use client";

import { Check, Info, TriangleAlert } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Alert, buttonClass, dangerQuietButtonClass, Field, Input, inputClass, Notice, pillClass, secondaryButtonClass } from "@/components/ui";
import type { NoteKind } from "@/lib/platform";
import { addNote, type FormState, markNoteDone, publishAnnouncement, withdrawAnnouncement } from "./actions";

function Result({ state }: { state: FormState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.message) return <Notice tone="success">{state.message}</Notice>;
  return null;
}

/** "2026-11-19" plus n days. */
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const KINDS: { value: NoteKind; label: string }[] = [
  { value: "CALL", label: "Call" },
  { value: "PROMISE", label: "Promise to pay" },
  { value: "NOTE", label: "Note" },
];

/**
 * What was said or agreed with the clinic, for whoever picks it up next. A follow-up day puts it on
 * the Follow-ups list; a promise to pay needs the day they said they would pay.
 */
export function NoteForm({ tenantId, today }: { tenantId: string; today: string }) {
  const [kind, setKind] = useState<NoteKind>("CALL");
  const [day, setDay] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const result = await addNote(tenantId, prev, form);
    if (result.ok) setDay("");
    return result;
  }, {});
  const promise = kind === "PROMISE";
  return (
    <form action={action} className="space-y-3">
      <Result state={state} />
      <fieldset>
        <legend className="sr-only">Kind of note</legend>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <label key={k.value} className={`${pillClass(kind === k.value)} cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-brand-600`}>
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={promise ? "What they promised" : kind === "CALL" ? "What was said" : "Note"}>
        <textarea
          name="body"
          required
          minLength={2}
          maxLength={2000}
          rows={3}
          className={inputClass}
          placeholder={promise ? "e.g. The manager will pay the November invoice by bank transfer" : kind === "CALL" ? "e.g. Called the admin: the trial is going well, they want the Standard plan" : ""}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={promise ? "They will pay by" : "Follow up on (optional)"}>
          <Input name="followUpOn" type="date" min={today} max={plusDays(today, 366)} required={promise} value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
        </Field>
        <div className="flex gap-1 pb-0.5" role="group" aria-label="Follow-up day">
          {[
            { n: 1, label: "Tomorrow" },
            { n: 3, label: "3 days" },
            { n: 7, label: "A week" },
          ].map((q) => (
            <button key={q.n} type="button" onClick={() => setDay(plusDays(today, q.n))} className={`${secondaryButtonClass} min-h-9 px-2.5 text-xs`}>
              {q.label}
            </button>
          ))}
        </div>
        <button disabled={pending} className={`${buttonClass} ml-auto`}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function NoteDone({ noteId }: { noteId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await markNoteDone(noteId);
            setError(r.error);
          })
        }
        className={`${secondaryButtonClass} min-h-9 gap-1.5 px-3 text-xs`}
      >
        <Check aria-hidden className="size-3.5" />
        {pending ? "Saving…" : "Done"}
      </button>
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}

// ─── Announcements ──────────────────────────────────────────────────────────────────────────────

/** How the message looks at the top of the clinic app (the same colours as there). */
export function AnnouncementPreview({ tone, title, body }: { tone: "INFO" | "WARNING"; title: string; body: string }) {
  const Icon = tone === "WARNING" ? TriangleAlert : Info;
  return (
    <div
      className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${
        tone === "WARNING"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
          : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100"
      }`}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{title || "The title"}</p>
        {body && <p className="mt-0.5 whitespace-pre-line opacity-90">{body}</p>}
      </div>
    </div>
  );
}

export function AnnouncementForm({ clinics }: { clinics: { id: string; name: string }[] }) {
  const [tone, setTone] = useState<"INFO" | "WARNING">("INFO");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const result = await publishAnnouncement(prev, form);
    if (result.ok) {
      setTitle("");
      setBody("");
    }
    return result;
  }, {});
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" hint={tone === "WARNING" ? "Stays until it ends: staff cannot close it." : "Staff can close it."}>
          <select name="tone" value={tone} onChange={(e) => setTone(e.target.value as "INFO" | "WARNING")} className={inputClass}>
            <option value="INFO">Information</option>
            <option value="WARNING">Warning</option>
          </select>
        </Field>
        <Field label="To">
          <select name="tenantId" className={inputClass} defaultValue="">
            <option value="">Every clinic</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          <Input name="title" required minLength={3} maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="HMIS will be updated on Sunday from 22:00" />
        </Field>
        <Field label="Title in Amharic" hint="Shown to staff using HMIS in Amharic. Left empty, they see the English.">
          <Input name="titleAm" maxLength={140} lang="am" />
        </Field>
        <Field label="Details (optional)">
          <textarea name="body" rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass} placeholder="For about 15 minutes HMIS may not open. Nothing is lost." />
        </Field>
        <Field label="Details in Amharic">
          <textarea name="bodyAm" rows={3} maxLength={1000} lang="am" className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Show from" hint="Addis Ababa time. Empty: now.">
          <Input name="startsAt" type="datetime-local" />
        </Field>
        <Field label="Until" hint="Empty: until it is withdrawn.">
          <Input name="endsAt" type="datetime-local" />
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">How clinics will see it</p>
        <AnnouncementPreview tone={tone} title={title} body={body} />
      </div>
      <button disabled={pending} className={buttonClass}>
        {pending ? "Publishing…" : "Publish"}
      </button>
    </form>
  );
}

export function WithdrawAnnouncement({ id }: { id: string }) {
  const [sure, setSure] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!sure) {
    return (
      <button type="button" onClick={() => setSure(true)} className={`${secondaryButtonClass} min-h-9 px-3 text-xs`}>
        Withdraw
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await withdrawAnnouncement(id);
            setError(r.error);
          })
        }
        className={`${dangerQuietButtonClass} min-h-9 px-3 text-xs`}
      >
        {pending ? "Withdrawing…" : "Take it down now"}
      </button>
      <button type="button" onClick={() => setSure(false)} className={`${secondaryButtonClass} min-h-9 px-3 text-xs`}>
        Keep
      </button>
      {error && <span className="w-full text-xs text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}

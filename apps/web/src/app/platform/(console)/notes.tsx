import { HandCoins, NotebookPen, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { clinicToday } from "@/lib/format";
import type { ClinicNote, NoteKind } from "@/lib/platform";
import { NoteDone } from "../followup-forms";
import { date, dateTime } from "./bits";

export const NOTE_KIND: Record<NoteKind, { label: string; icon: typeof Phone; tone: string }> = {
  CALL: { label: "Call", icon: Phone, tone: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  PROMISE: { label: "Promise to pay", icon: HandCoins, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  NOTE: { label: "Note", icon: NotebookPen, tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

/** When a follow-up is for, in words: "today", "2 days late", "on 24 Nov 2026"; or when it was done. */
export function FollowUpWhen({ note, daysLate, today }: { note: Pick<ClinicNote, "kind" | "followUpOn" | "doneAt" | "doneBy">; daysLate: number; today: string }) {
  if (!note.followUpOn) return null;
  const promise = note.kind === "PROMISE";
  if (note.doneAt) {
    return (
      <span className="text-xs text-slate-500">
        {promise ? "Promise checked" : "Followed up"} {date(note.doneAt)}
        {note.doneBy ? ` by ${note.doneBy}` : ""}
      </span>
    );
  }
  const day = clinicToday(new Date(note.followUpOn)) === today;
  const cls = daysLate > 0 ? "text-red-700 dark:text-red-400" : day ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-slate-300";
  return (
    <span className={`text-xs font-medium ${cls}`}>
      {promise ? "To pay by" : "Follow up"} {date(note.followUpOn)}
      {daysLate > 0 ? ` · ${daysLate} day${daysLate === 1 ? "" : "s"} late${promise ? ": promise not kept" : ""}` : day ? " · today" : ""}
    </span>
  );
}

/** One note: what kind, what was said, who wrote it when, and its follow-up (with Done). */
export function NoteItem({ note, daysLate, today, extra }: { note: ClinicNote; daysLate: number; today: string; extra?: ReactNode }) {
  const k = NOTE_KIND[note.kind] ?? NOTE_KIND.NOTE;
  const open = note.followUpOn && !note.doneAt;
  return (
    <li className="flex gap-3 py-3">
      <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full ${k.tone}`}>
        <k.icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700 dark:text-slate-200">{k.label}</span>
          <span>
            {note.operator ?? "Someone"} · {dateTime(note.createdAt)}
          </span>
        </p>
        {extra}
        <p className="mt-0.5 text-sm break-words whitespace-pre-line text-slate-900 dark:text-slate-100">{note.body}</p>
        <FollowUpWhen note={note} daysLate={daysLate} today={today} />
      </div>
      {open && (
        <div className="shrink-0">
          <NoteDone noteId={note.id} />
        </div>
      )}
    </li>
  );
}

/** Whole Addis Ababa days from a follow-up day to today (0 when today or later). */
export const lateBy = (followUpOn: string | null, today: string) => (followUpOn ? Math.max(0, Math.round((Date.parse(today) - Date.parse(clinicToday(new Date(followUpOn)))) / 86_400_000)) : 0);

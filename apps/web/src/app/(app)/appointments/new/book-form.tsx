"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { bookAppointment, type FormState } from "@/app/actions";
import type { BookingLoad, Doctor } from "@/lib/api";
import { formatEthiopian } from "@/lib/format";
import { Alert, buttonClass, Field, Input, inputClass, secondaryButtonClass } from "@/components/ui";

export function BookForm({
  patientId,
  doctors,
  today,
  load = [],
  move,
}: {
  patientId: string;
  doctors: Doctor[];
  today: string;
  /** Bookings per day and doctor, to spread them out. */
  load?: BookingLoad;
  /** Moving this booked appointment instead of booking a new one. */
  move?: { id: string; date: string; time: string; doctorId: string | null };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(bookAppointment, {});
  const v = state.values ?? {};
  const err = state.fieldErrors ?? {};
  const [date, setDate] = useState(v.date ?? move?.date ?? today);
  const booked = load.filter((l) => l.day === date);
  const name = (id: string | null) => (id ? `Dr. ${doctors.find((d) => d.id === id)?.fullName ?? "?"}` : "any doctor");

  return (
    <form action={action} className="max-w-md space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="patientId" value={patientId} />
      {move && <input type="hidden" name="appointmentId" value={move.id} />}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date" hint={date ? formatEthiopian(new Date(`${date}T12:00:00+03:00`)) : undefined}>
          <Input name="date" type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time" error={err.scheduledAt} hint="Clinic time">
          <Input name="time" type="time" required step={900} defaultValue={v.time ?? move?.time ?? "09:00"} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-slate-500" aria-live="polite">
        {booked.length === 0
          ? "Nothing booked on that day yet."
          : `Already booked that day: ${booked.map((b) => `${name(b.doctorId)} ${b.count}`).join(" · ")}`}
      </p>
      <Field label="Doctor" error={err.doctorId}>
        <select name="doctorId" defaultValue={v.doctorId ?? move?.doctorId ?? ""} className={inputClass}>
          <option value="">Any doctor</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              Dr. {d.fullName}
            </option>
          ))}
        </select>
      </Field>
      {!move && (
        <Field label="Reason" error={err.reason}>
          <Input name="reason" placeholder="e.g. Follow-up, lab results" defaultValue={v.reason} />
        </Field>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : move ? "Move appointment" : "Book appointment"}
        </button>
        <Link href={`/patients/${patientId}`} className={secondaryButtonClass}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

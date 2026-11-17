"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { bookAppointment, type FormState } from "@/app/actions";
import type { BookingLoad, Doctor } from "@/lib/api";
import { formatEthiopian } from "@/lib/format";
import { useT } from "@/components/lang-provider";
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
  const t = useT();
  const fe = state.fieldErrors ?? {};
  const err = Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m ? t(m) : m]));
  const [date, setDate] = useState(v.date ?? move?.date ?? today);
  const booked = load.filter((l) => l.day === date);
  const name = (id: string | null) => (id ? t("Dr. {name}", { name: doctors.find((d) => d.id === id)?.fullName ?? "?" }) : t("any doctor"));

  return (
    <form action={action} className="max-w-md space-y-4">
      {state.error && <Alert>{t(state.error)}</Alert>}
      <input type="hidden" name="patientId" value={patientId} />
      {move && <input type="hidden" name="appointmentId" value={move.id} />}
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("Date")} hint={date ? formatEthiopian(new Date(`${date}T12:00:00+03:00`)) : undefined}>
          <Input name="date" type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("Time")} error={err.scheduledAt} hint={t("Clinic time")}>
          <Input name="time" type="time" required step={900} defaultValue={v.time ?? move?.time ?? "09:00"} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-slate-500" aria-live="polite">
        {booked.length === 0
          ? t("Nothing booked on that day yet.")
          : t("Already booked that day: {list}", { list: booked.map((b) => `${name(b.doctorId)} ${b.count}`).join(" · ") })}
      </p>
      <Field label={t("Doctor")} error={err.doctorId}>
        <select name="doctorId" defaultValue={v.doctorId ?? move?.doctorId ?? ""} className={inputClass}>
          <option value="">{t("Any doctor")}</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {t("Dr. {name}", { name: d.fullName })}
            </option>
          ))}
        </select>
      </Field>
      {!move && (
        <Field label={t("Reason")} error={err.reason}>
          <Input name="reason" placeholder={t("e.g. Follow-up, lab results")} defaultValue={v.reason} />
        </Field>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? t("Saving…") : move ? t("Move appointment") : t("Book appointment")}
        </button>
        <Link href={`/patients/${patientId}`} className={secondaryButtonClass}>
          {t("Cancel")}
        </Link>
      </div>
    </form>
  );
}

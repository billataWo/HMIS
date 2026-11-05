"use client";

import { useActionState } from "react";
import { checkIn, type FormState } from "@/app/actions";
import type { Doctor, Service } from "@/lib/api";
import { Alert, buttonClass, inputClass } from "./ui";

export function CheckInForm({
  patientId,
  appointmentId,
  defaultDoctorId,
  doctors,
  services,
  returnTo,
}: {
  patientId: string;
  appointmentId?: string;
  defaultDoctorId?: string;
  doctors: Doctor[];
  services: Service[];
  returnTo: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(checkIn, {});
  const defaultService = services.find((s) => s.code === "CONS-GEN") ?? services[0];

  return (
    <form action={action} className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {appointmentId && <input type="hidden" name="appointmentId" value={appointmentId} />}
      <div className="flex flex-wrap gap-2">
        <select name="doctorId" defaultValue={defaultDoctorId ?? ""} className={`${inputClass} w-auto min-w-40 flex-1`} aria-label="Doctor">
          <option value="">Any doctor</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              Dr. {d.fullName}
            </option>
          ))}
        </select>
        <select name="serviceId" defaultValue={defaultService?.id ?? ""} className={`${inputClass} w-auto min-w-40 flex-1`} aria-label="Fee">
          <option value="">No fee</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {Number(s.price).toFixed(2)} ETB
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Checking in…" : "Check in"}
        </button>
      </div>
    </form>
  );
}

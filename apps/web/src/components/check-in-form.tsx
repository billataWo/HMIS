"use client";

import { useActionState } from "react";
import { checkIn, type FormState } from "@/app/actions";
import type { CoverageOption, Doctor, Service } from "@/lib/api";
import { CoverageChoice } from "./coverage-choice";
import { Alert, buttonClass, inputClass } from "./ui";

export function CheckInForm({
  patientId,
  appointmentId,
  defaultDoctorId,
  doctors,
  services,
  coverages = [],
  returnTo,
}: {
  patientId: string;
  appointmentId?: string;
  defaultDoctorId?: string;
  doctors: Doctor[];
  services: Service[];
  /** The patient's coverages: the visit can be billed to one of them. */
  coverages?: CoverageOption[];
  returnTo: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(checkIn, {});
  // Only fees are taken at check-in; procedures are recorded during the visit.
  const fees = services.filter((s) => s.kind !== "PROCEDURE");
  const defaultService = fees.find((s) => s.code === "CONS-GEN") ?? fees[0];

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
              {d.room ? ` · ${d.room}` : ""}
            </option>
          ))}
        </select>
        <select name="serviceId" defaultValue={defaultService?.id ?? ""} className={`${inputClass} w-auto min-w-40 flex-1`} aria-label="Fee">
          <option value="">No fee</option>
          {fees.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {Number(s.price).toFixed(2)} ETB
            </option>
          ))}
        </select>
        <input name="referredFrom" maxLength={200} placeholder="Referred from (if any)" aria-label="Referred from" className={`${inputClass} w-auto min-w-44 flex-1`} />
        {/* A covered patient is checked in on their payer unless the desk chooses otherwise. */}
        <CoverageChoice coverages={coverages} className="w-auto min-w-64 flex-1" />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Checking in…" : "Check in"}
        </button>
      </div>
    </form>
  );
}

import type { Me, Role } from "./api";

/** The front desk: checks patients in and registers them. */
export const FRONT_DESK: Role[] = ["ADMIN", "RECEPTIONIST", "NURSE"];

/**
 * Who may create patient records: the front desk, plus doctors when the admin has turned on
 * "doctors can register patients" in Settings. Mirrors the API's rule on POST /patients.
 */
export function canRegister(me: Pick<Me, "role" | "tenant">) {
  return FRONT_DESK.includes(me.role) || (me.role === "DOCTOR" && !!me.tenant.doctorsCanRegister);
}

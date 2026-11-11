"use server";

import { publicPost } from "@/lib/public-api";

/** `status`: the reply status (0: the server could not be reached), so the form can explain it in its language. */
export type RequestState = { error?: string; fields?: Record<string, string>; reference?: string; status?: number };

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const optional = (form: FormData, name: string) => text(form, name) || undefined;

/** "We would like to use HMIS": HMIS reviews it and calls the clinic. */
export async function sendRequest(_: RequestState, form: FormData): Promise<RequestState> {
  const staff = Number(text(form, "staffCount"));
  const result = await publicPost<{ reference: string }>("/public/clinic-requests", {
    clinicName: text(form, "clinicName"),
    clinicNameAm: optional(form, "clinicNameAm"),
    type: text(form, "type") || "CLINIC",
    region: text(form, "region"),
    city: text(form, "city"),
    address: optional(form, "address"),
    licenceNumber: optional(form, "licenceNumber"),
    contactName: text(form, "contactName"),
    contactPhone: text(form, "contactPhone"),
    contactEmail: optional(form, "contactEmail"),
    planCode: optional(form, "planCode"),
    staffCount: Number.isInteger(staff) && staff > 0 ? staff : undefined,
    deployment: text(form, "deployment") || "CLOUD",
    message: optional(form, "message"),
    website: optional(form, "website"),
    termsVersion: optional(form, "termsVersion"),
  });
  if (result.ok) return { reference: result.data.reference };
  const fields = Object.fromEntries((result.errors ?? []).map((e) => [e.field, e.message]));
  return { error: result.errors?.length ? "Please check the highlighted fields." : result.message, fields, status: result.status };
}

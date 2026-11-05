"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  api,
  API_URL,
  ApiError,
  NOTE_FIELDS,
  TOKEN_COOKIE,
  VITAL_FIELDS,
  type DrugOption,
  type Frequency,
  type IcdEntry,
  type Patient,
  type RxAlert,
} from "@/lib/api";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  ok?: boolean;
}

function toFormState(e: unknown, values: Record<string, string>): FormState {
  if (e instanceof ApiError) {
    const fieldErrors = Object.fromEntries((e.body.errors ?? []).map((x) => [x.field, x.message]));
    return { error: e.body.errors?.length ? "Please fix the highlighted fields." : e.message, fieldErrors, values };
  }
  throw e;
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const phone = text(form, "phone");
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password: String(form.get("password") ?? "") }),
      cache: "no-store",
    });
  } catch {
    return { error: "Cannot reach the server. Check that the API is running.", values: { phone } };
  }
  if (!res.ok) return { error: "Wrong phone number or password.", values: { phone } };

  const { token } = (await res.json()) as { token: string };
  (await cookies()).set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60,
    path: "/",
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(TOKEN_COOKIE);
  redirect("/login");
}

export async function createPatient(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const age = text(form, "ageYears");
  const body = {
    firstName: text(form, "firstName"),
    fatherName: text(form, "fatherName"),
    grandfather: text(form, "grandfather"),
    firstNameAm: text(form, "firstNameAm"),
    fatherNameAm: text(form, "fatherNameAm"),
    sex: text(form, "sex") || undefined,
    dateOfBirth: text(form, "dateOfBirth") || undefined,
    ageYears: age ? Number(age) : undefined,
    phone: text(form, "phone"),
    address: text(form, "address"),
    relativeId: text(form, "relativeId") || undefined,
    allergies: text(form, "allergies")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  let patient: Patient;
  try {
    patient = await api<Patient>("/patients", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toFormState(e, values);
  }
  redirect(`/patients/${patient.id}`);
}

export async function createUser(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  try {
    await api("/users", {
      method: "POST",
      body: JSON.stringify({
        fullName: text(form, "fullName"),
        phone: text(form, "phone"),
        role: text(form, "role"),
        password: String(form.get("password") ?? ""),
        email: text(form, "email") || undefined,
      }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  redirect("/users");
}

/** Sends the user back to `path` with a message; used by one-click buttons that have no form state. */
function back(path: string, message?: string): never {
  const url = new URL(path.startsWith("/") && !path.startsWith("//") ? path : "/", "http://local");
  for (const k of ["error", "checkedIn", "booked", "done"]) url.searchParams.delete(k);
  if (message) {
    const [k, v] = message.split("=");
    url.searchParams.set(k, decodeURIComponent(v));
  }
  redirect(url.pathname + url.search);
}

export async function checkIn(_: FormState, form: FormData): Promise<FormState> {
  const returnTo = text(form, "returnTo") || "/queue";
  let visit: { queueNumber: number };
  try {
    visit = await api<{ queueNumber: number }>("/visits", {
      method: "POST",
      body: JSON.stringify({
        patientId: text(form, "patientId"),
        doctorId: text(form, "doctorId") || undefined,
        serviceId: text(form, "serviceId") || undefined,
        appointmentId: text(form, "appointmentId") || undefined,
      }),
    });
  } catch (e) {
    return toFormState(e, {});
  }
  back(returnTo, `checkedIn=${visit.queueNumber}`);
}

export async function moveVisit(id: string, status: string, returnTo: string) {
  try {
    await api(`/visits/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  } catch (e) {
    if (e instanceof ApiError) back(returnTo, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(returnTo);
}

export async function bookAppointment(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const date = text(form, "date");
  const time = text(form, "time");
  if (!date || !time) return { error: "Choose a date and time.", values };
  try {
    await api("/appointments", {
      method: "POST",
      body: JSON.stringify({
        patientId: text(form, "patientId"),
        scheduledAt: `${date}T${time}:00+03:00`, // entered in clinic (Addis Ababa) time
        doctorId: text(form, "doctorId") || undefined,
        reason: text(form, "reason"),
      }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  redirect(`/appointments?day=${date}&booked=1`);
}

export async function setAppointmentStatus(id: string, status: "CANCELLED" | "NO_SHOW", returnTo: string) {
  try {
    await api(`/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  } catch (e) {
    if (e instanceof ApiError) back(returnTo, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(returnTo);
}

/**
 * Saves the consultation form. Only fields present in the form are sent, so a nurse's triage
 * form (vitals + complaint) never touches the doctor's notes. A "then" button value moves the
 * visit on after a successful save, so "Save & complete" can't lose unsaved notes.
 */
export async function saveConsultation(_: FormState, form: FormData): Promise<FormState> {
  const visitId = text(form, "visitId");
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const body: Record<string, number | string | null> = {};
  for (const f of VITAL_FIELDS) {
    if (!form.has(f)) continue;
    const raw = text(form, f);
    body[f] = raw === "" ? null : Number(raw);
  }
  for (const f of NOTE_FIELDS) {
    if (form.has(f)) body[f] = text(form, f) || null;
  }

  try {
    await api(`/visits/${visitId}`, { method: "PATCH", body: JSON.stringify(body) });
    const then = text(form, "then");
    if (then) await api(`/visits/${visitId}/status`, { method: "PATCH", body: JSON.stringify({ status: then }) });
  } catch (e) {
    return toFormState(e, values);
  }

  if (text(form, "then") === "COMPLETED") redirect("/queue");
  refresh();
  return { ok: true, values };
}

export async function addDiagnosis(visitId: string, entry: { icd11Code: string; label: string; isPrimary?: boolean }) {
  try {
    await api(`/visits/${visitId}/diagnoses`, { method: "POST", body: JSON.stringify(entry) });
  } catch (e) {
    if (e instanceof ApiError) return { error: e.body.errors?.[0]?.message ?? e.message };
    throw e;
  }
  refresh();
  return {};
}

export async function removeDiagnosis(visitId: string, diagnosisId: string) {
  await api(`/visits/${visitId}/diagnoses/${diagnosisId}`, { method: "DELETE" });
  refresh();
}

export async function searchIcd(q: string): Promise<IcdEntry[]> {
  if (q.trim().length < 2) return [];
  return api<IcdEntry[]>(`/icd11?q=${encodeURIComponent(q)}`);
}

export async function searchDrugs(q: string): Promise<DrugOption[]> {
  if (q.trim().length < 2) return [];
  return api<DrugOption[]>(`/drugs?q=${encodeURIComponent(q)}`);
}

export interface RxDraftItem {
  drugId: string;
  dose: string;
  frequency: Frequency;
  durationDays?: number;
  quantity: number;
  instructions?: string;
}

/** Returns the alerts when the API wants the doctor to confirm; otherwise saves and refreshes. */
export async function createPrescription(
  visitId: string,
  items: RxDraftItem[],
  confirm?: { overrideReason?: string },
): Promise<{ ok?: boolean; alerts?: RxAlert[]; error?: string }> {
  try {
    await api(`/visits/${visitId}/prescriptions`, {
      method: "POST",
      body: JSON.stringify({ items, acknowledgeAlerts: !!confirm, overrideReason: confirm?.overrideReason }),
    });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.body.alerts) return { alerts: e.body.alerts, error: confirm ? e.message : undefined };
      return { error: e.body.errors?.map((x) => x.message).join(", ") || e.message };
    }
    throw e;
  }
  refresh();
  return { ok: true };
}

export async function cancelPrescription(id: string) {
  await api(`/prescriptions/${id}/cancel`, { method: "POST" });
  refresh();
}

/**
 * Form fields are named qty_<itemId>; blank or zero means "not this time". The submit button's
 * "step" value picks the action: "bill" sends the units to the cashier, otherwise dispense.
 */
export async function dispensePrescription(_: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "prescriptionId");
  const step = text(form, "step") === "bill" ? "bill" : "dispense";
  const items = [...form.entries()]
    .filter(([k]) => k.startsWith(`${step}_`))
    .map(([k, v]) => ({ itemId: k.slice(step.length + 1), quantity: Number(v) }))
    .filter((i) => Number.isInteger(i.quantity) && i.quantity > 0);
  if (!items.length) return { error: step === "bill" ? "Enter a quantity to send to the cashier." : "Enter a quantity to dispense." };
  try {
    await api(`/prescriptions/${id}/${step}`, { method: "POST", body: JSON.stringify({ items }) });
  } catch (e) {
    return toFormState(e, {});
  }
  refresh();
  return { ok: true, values: { step } };
}

export async function orderLabTests(visitId: string, labTestIds: string[]): Promise<{ error?: string }> {
  try {
    await api(`/visits/${visitId}/lab-orders`, { method: "POST", body: JSON.stringify({ labTestIds }) });
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    throw e;
  }
  refresh();
  return {};
}

export async function cancelLabOrder(id: string) {
  await api(`/lab-orders/${id}/cancel`, { method: "POST" });
  refresh();
}

/** One form per lab order; the "step" field says which bench action to take. */
export async function labStep(_: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "orderId");
  const step = text(form, "step");
  const body =
    step === "collect"
      ? { sampleId: text(form, "sampleId") || undefined }
      : step === "result"
        ? { value: text(form, "value"), note: text(form, "note") || undefined }
        : {};
  if (!["collect", "result", "verify"].includes(step)) return { error: "Unknown action." };
  try {
    await api(`/lab-orders/${id}/${step}`, { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toFormState(e, Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
  }
  refresh();
  return { ok: true };
}

const formValues = (form: FormData) => Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));

export async function saveDrug(_: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const id = text(form, "id");
  const body = {
    genericName: text(form, "genericName"),
    brandName: text(form, "brandName") || null,
    drugClass: text(form, "drugClass") || null,
    form: text(form, "form"),
    strength: text(form, "strength") || null,
    unit: text(form, "unit"),
    sellPrice: Number(text(form, "sellPrice")),
    reorderLevel: Number(text(form, "reorderLevel") || 0),
    ...(id && { active: form.get("active") === "on" }),
  };
  let saved: { id: string };
  try {
    saved = await api<{ id: string }>(id ? `/drugs/${id}` : "/drugs", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toFormState(e, values);
  }
  if (!id) redirect(`/inventory/drugs/${saved.id}`);
  refresh();
  return { ok: true, values };
}

export interface ReceiptLine {
  drugId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  costPrice: number;
}

export async function receiveStock(input: { supplierId?: string; receiptRef?: string; items: ReceiptLine[] }): Promise<{ error?: string; warnings?: string[]; received?: number }> {
  try {
    const res = await api<{ received: unknown[]; warnings: string[] }>("/inventory/receipts", { method: "POST", body: JSON.stringify(input) });
    refresh();
    return { warnings: res.warnings, received: res.received.length };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.body.errors?.map((x) => `${x.field}: ${x.message}`).join("; ") || e.message };
    throw e;
  }
}

export async function adjustStock(_: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const direction = text(form, "direction") === "add" ? 1 : -1;
  try {
    await api("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({
        batchId: text(form, "batchId"),
        quantity: direction * Math.abs(Number(text(form, "quantity"))),
        reason: text(form, "reason"),
        note: text(form, "note") || null,
      }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true };
}

export async function writeOffExpired(): Promise<void> {
  const res = await api<{ batches: number; units: number; value: string }>("/inventory/expired/write-off", { method: "POST" });
  back("/inventory", `done=${encodeURIComponent(`Wrote off ${res.units} expired units from ${res.batches} batches (cost ${res.value} ETB).`)}`);
}

export async function saveSupplier(_: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const id = text(form, "id");
  try {
    await api(id ? `/suppliers/${id}` : "/suppliers", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({
        name: text(form, "name"),
        phone: text(form, "phone") || null,
        contactPerson: text(form, "contactPerson") || null,
        tin: text(form, "tin") || null,
      }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true };
}

export async function setSupplierActive(id: string, active: boolean) {
  await api(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
  refresh();
}

export async function saveService(_: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const id = text(form, "id");
  try {
    await api(id ? `/catalog/services/${id}` : "/catalog/services", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({
        ...(!id && { code: text(form, "code") }),
        name: text(form, "name"),
        price: Number(text(form, "price")),
        ...(id && { active: form.get("active") === "on" }),
      }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true, values: id ? values : {} };
}

export async function saveLabTest(_: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const id = text(form, "id");
  const num = (k: string) => (text(form, k) === "" ? null : Number(text(form, k)));
  const options = text(form, "resultOptions")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    await api(id ? `/catalog/lab-tests/${id}` : "/catalog/lab-tests", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({
        name: text(form, "name"),
        unit: text(form, "unit") || null,
        loincCode: text(form, "loincCode") || null,
        refLow: num("refLow"),
        refHigh: num("refHigh"),
        price: Number(text(form, "price")),
        resultOptions: options,
        ...(id && { active: form.get("active") === "on" }),
      }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true, values: id ? values : {} };
}

export async function saveSettings(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  try {
    await api("/settings", {
      method: "PATCH",
      body: JSON.stringify({
        name: text(form, "name"),
        nameAm: text(form, "nameAm") || null,
        phone: text(form, "phone") || null,
        address: text(form, "address") || null,
        requirePrepayment: form.get("requirePrepayment") === "on",
      }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true, values };
}

const optionalNumber = (form: FormData, key: string) => {
  const raw = text(form, key);
  return raw ? Number(raw) : undefined;
};

export async function createInvoice(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  let id: string;
  try {
    ({ id } = await api<{ id: string }>("/invoices", {
      method: "POST",
      body: JSON.stringify({
        visitId: text(form, "visitId"),
        payerType: text(form, "payerType") || "SELF",
        payerName: text(form, "payerName") || undefined,
        discount: optionalNumber(form, "discount"),
        discountReason: text(form, "discountReason") || undefined,
      }),
    }));
  } catch (e) {
    return toFormState(e, values);
  }
  redirect(`/billing/invoices/${id}`);
}

export async function recordPayment(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  try {
    await api(`/invoices/${text(form, "invoiceId")}/payments`, {
      method: "POST",
      body: JSON.stringify({ method: text(form, "method"), amount: Number(text(form, "amount")), reference: text(form, "reference") || undefined }),
    });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true };
}

export async function voidInvoice(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  try {
    await api(`/invoices/${text(form, "invoiceId")}/void`, { method: "POST", body: JSON.stringify({ reason: text(form, "reason") }) });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true };
}

export async function closeCash(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const counted = text(form, "countedCash");
  if (counted === "") return { error: "Enter the cash you counted.", values };
  try {
    await api("/billing/closings", { method: "POST", body: JSON.stringify({ countedCash: Number(counted), note: text(form, "note") || undefined }) });
  } catch (e) {
    return toFormState(e, values);
  }
  refresh();
  return { ok: true };
}

export async function setUserActive(id: string, active: boolean) {
  await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
  redirect("/users");
}

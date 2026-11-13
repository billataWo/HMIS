"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/app/actions";
import { api, ApiError } from "@/lib/api";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const values = (form: FormData) => Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
const num = (form: FormData, key: string) => (text(form, key) === "" ? null : Number(text(form, key).replace(",", ".")));

/** Sends a form to the API; field errors and messages come back to the form. */
async function send(path: string, method: string, body: unknown, form: FormData, keep = false): Promise<FormState> {
  try {
    await api(path, { method, body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) {
      const fieldErrors = Object.fromEntries((e.body.errors ?? []).map((x) => [x.field, x.message]));
      return { error: e.body.errors?.length ? Object.values(fieldErrors)[0] || e.message : e.message, fieldErrors, values: values(form) };
    }
    throw e;
  }
  refresh();
  return { ok: true, values: keep ? values(form) : {} };
}

/** A new control for a test: a measured level (mean and SD) or a kit control (its answer). */
export async function addQcControl(_: FormState, form: FormData): Promise<FormState> {
  const kit = text(form, "kind") === "kit";
  return send(
    "/lab/qc/controls",
    "POST",
    {
      labTestId: text(form, "labTestId"),
      name: text(form, "name"),
      lot: text(form, "lot") || null,
      expiresAt: text(form, "expiresAt") || null,
      ...(kit ? { expected: text(form, "expected") || null } : { mean: num(form, "mean"), sd: num(form, "sd") }),
    },
    form,
  );
}

/** A control is no longer used (a new lot replaced it), or used again. */
export async function setQcControlActive(id: string, active: boolean) {
  await api(`/lab/qc/controls/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
  refresh();
}

export async function recordQcRun(_: FormState, form: FormData): Promise<FormState> {
  return send("/lab/qc/results", "POST", { controlId: text(form, "controlId"), value: text(form, "value"), note: text(form, "note") || null }, form);
}

export async function recordQcAction(_: FormState, form: FormData): Promise<FormState> {
  return send(`/lab/qc/results/${text(form, "runId")}/action`, "POST", { action: text(form, "action") }, form);
}

export async function addReagent(_: FormState, form: FormData): Promise<FormState> {
  return send("/lab/reagents", "POST", { name: text(form, "name"), unit: text(form, "unit"), reorderLevel: num(form, "reorderLevel") ?? 0 }, form);
}

export async function updateReagent(_: FormState, form: FormData): Promise<FormState> {
  return send(
    `/lab/reagents/${text(form, "id")}`,
    "PATCH",
    { reorderLevel: num(form, "reorderLevel") ?? 0, active: form.get("active") === "on" },
    form,
    true,
  );
}

export async function receiveReagent(_: FormState, form: FormData): Promise<FormState> {
  return send(
    `/lab/reagents/${text(form, "id")}/receive`,
    "POST",
    { quantity: num(form, "quantity"), lot: text(form, "lot") || null, expiresAt: text(form, "expiresAt") || null },
    form,
  );
}

export async function adjustReagent(_: FormState, form: FormData): Promise<FormState> {
  return send(
    `/lab/reagents/${text(form, "id")}/adjust`,
    "POST",
    { lotId: text(form, "lotId"), quantity: num(form, "quantity"), reason: text(form, "reason"), note: text(form, "note") || null },
    form,
  );
}

/** The tests that use a reagent: each ticked test with how many units it takes. */
export async function setReagentUses(_: FormState, form: FormData): Promise<FormState> {
  const uses = form
    .getAll("test")
    .map(String)
    .map((labTestId) => ({ labTestId, perTest: num(form, `per_${labTestId}`) ?? 1 }));
  return send(`/lab/reagents/${text(form, "id")}/uses`, "PUT", { uses }, form, true);
}

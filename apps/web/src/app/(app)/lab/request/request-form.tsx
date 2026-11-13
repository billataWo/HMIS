"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { labWalkIn, searchPatients, type FormState } from "@/app/actions";
import { Alert, buttonClass, Field, Input, inputClass, linkClass, secondaryButtonClass } from "@/components/ui";
import type { LabTest, Patient } from "@/lib/api";
import { etb, fullName } from "@/lib/format";

type Who = Pick<Patient, "id" | "mrn" | "firstName" | "fatherName" | "grandfather">;

/**
 * Tests for someone who is not seeing a doctor here: pick the patient (registered first, so the
 * results go on their record), tick the tests, and note who asked for them.
 */
export function RequestForm({ tests, patient: preset, returnTo }: { tests: LabTest[]; patient: Who | null; returnTo: "lab" | "patient" }) {
  const [state, action, pending] = useActionState<FormState, FormData>(labWalkIn, {});
  const [patient, setPatient] = useState<Who | null>(preset);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Patient[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const results = q.trim().length < 2 ? [] : found;
  const total = tests.filter((t) => picked.includes(t.id)).reduce((s, t) => s + Number(t.price), 0);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchPatients(q);
      if (!cancelled) setFound(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <form action={action} className="max-w-3xl space-y-6">
      <input type="hidden" name="returnTo" value={returnTo} />
      {state.error && <Alert>{state.error}</Alert>}

      <section className="surface space-y-3 p-5">
        <h2 className="font-semibold">Patient</h2>
        {patient ? (
          <p className="flex items-center gap-2 text-sm">
            <input type="hidden" name="patientId" value={patient.id} />
            <span className="font-medium">{fullName(patient)}</span>
            <span className="text-slate-500">{patient.mrn}</span>
            <button type="button" onClick={() => setPatient(null)} aria-label="Choose another patient" className="rounded p-1 text-slate-500 hover:text-red-700">
              <X aria-hidden className="size-4" />
            </button>
          </p>
        ) : (
          <>
            <div className="relative max-w-md">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or MRN" aria-label="Find the patient" className={`${inputClass} pl-9`} />
            </div>
            {results.length > 0 && (
              <ul className="max-w-md divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                {results.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => (setPatient(p), setQ(""))} className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                      {fullName(p)} <span className="text-slate-500">· {p.mrn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-slate-500">
              New here? The front desk{" "}
              <Link href="/patients/new" className={linkClass}>
                registers the patient
              </Link>{" "}
              first, so the results go on their record.
            </p>
          </>
        )}
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="font-semibold">Tests</h2>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {tests.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="labTestIds"
                value={t.id}
                checked={picked.includes(t.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))}
              />
              {t.name}
              <span className="text-xs text-slate-500">{Number(t.price).toFixed(0)} ETB</span>
            </label>
          ))}
        </div>
        <div className="max-w-md">
          <Field label="Requested by (optional)" hint="The doctor or clinic on the request paper; leave empty if the patient asked themselves">
            <Input name="requestedBy" maxLength={200} placeholder="e.g. Dr. Sara, Bole Clinic" defaultValue={state.values?.requestedBy} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="urgent" defaultChecked={state.values?.urgent === "on"} />
          Urgent: the request says the result is needed now (the lab does it first)
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !patient || picked.length === 0} className={buttonClass}>
          {pending ? "Adding…" : picked.length ? `Add ${picked.length} ${picked.length === 1 ? "test" : "tests"} · ${etb(total)}` : "Tick the tests"}
        </button>
        <Link href={returnTo === "lab" ? "/lab" : patient ? `/patients/${patient.id}` : "/patients"} className={secondaryButtonClass}>
          Cancel
        </Link>
        <span className="text-sm text-slate-500">The patient then pays at the cashier and gives the sample at the lab.</span>
      </div>
    </form>
  );
}

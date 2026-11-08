"use client";

import { Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Badge, buttonClass, Card, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { Patient, QueuePatient, Service } from "@/lib/api";
import { checkIn, type NewPatient, registerPatient } from "@/lib/offline/actions";
import { fullName, PatientLine, type TabProps, useBusy } from "./shared";

const norm = (s: string) => s.trim().toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "").slice(-9);

export function FrontDesk({ view, userId }: TabProps) {
  const fees = view.snap.services.filter((s) => s.kind !== "PROCEDURE");
  const [serviceId, setServiceId] = useState(fees[0]?.id ?? "");
  const service: Service | null = fees.find((s) => s.id === serviceId) ?? null;
  const [q, setQ] = useState("");
  const [busy, run] = useBusy();
  const [done, setDone] = useState<string | null>(null);

  const found = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return view.patients
      .filter((p) => {
        const hay = norm(`${p.mrn} ${p.firstName} ${p.fatherName} ${p.grandfather ?? ""} ${p.phone ?? ""} ${p.firstNameAm ?? ""} ${p.fatherNameAm ?? ""}`);
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 12);
  }, [q, view.patients]);
  const waitingIds = new Set(view.queue.filter((v) => v.status !== "COMPLETED" && v.status !== "CANCELLED").map((v) => v.patient.id));

  const doCheckIn = (p: QueuePatient) =>
    run(async () => {
      await checkIn(userId, p, service);
      setDone(`${fullName(p)} is checked in.`);
      setQ("");
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Card title="Check in a patient" description="Patients known on this PC: registered recently, seen today, or registered here offline.">
          <div className="flex flex-wrap gap-3">
            <label className="relative min-w-0 flex-1 basis-64">
              <span className="sr-only">Search patients</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or MRN" className={`${inputClass} pl-9`} />
            </label>
            <label className="basis-56">
              <span className="sr-only">Service</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputClass}>
                <option value="">No fee</option>
                {fees.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({Number(s.price).toFixed(2)})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {done && (
            <Notice tone="success" className="mt-4">
              {done}
            </Notice>
          )}
          {q && (
            <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {found.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <PatientLine p={p} />
                  {waitingIds.has(p.id) ? (
                    <Badge tone="info">In today&apos;s queue</Badge>
                  ) : (
                    <button disabled={busy} onClick={() => doCheckIn(p)} className={`${secondaryButtonClass} btn-size`}>
                      Check in
                    </button>
                  )}
                </li>
              ))}
              {!found.length && <li className="py-3 text-sm text-slate-500">Not on this PC. Register below; if the patient already has a card, the server will say so when this is sent.</li>}
            </ul>
          )}
        </Card>

        <RegisterForm view={view} userId={userId} onRegistered={(p) => doCheckIn(p)} onUseExisting={(p) => doCheckIn(p)} />
      </div>

      <Card title="Today's queue">
        <ol className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {view.queue.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-2 inline-block w-7 font-mono text-slate-500 tabular-nums">{v.offline ? "·" : v.queueNumber}</span>
                {fullName(v.patient)}
              </span>
              {v.offline ? <Badge tone="violet">Offline</Badge> : <StatusBadge status={v.status} />}
            </li>
          ))}
          {!view.queue.length && <li className="py-3 text-sm text-slate-500">Nobody yet.</li>}
        </ol>
      </Card>
    </div>
  );
}

function RegisterForm({
  view,
  userId,
  onRegistered,
  onUseExisting,
}: TabProps & { onRegistered: (p: QueuePatient) => void; onUseExisting: (p: QueuePatient) => void }) {
  const empty: NewPatient = { firstName: "", fatherName: "", grandfather: "", sex: "FEMALE", phone: "" };
  const [form, setForm] = useState<NewPatient & { age: string }>({ ...empty, age: "" });
  const [checkInNow, setCheckInNow] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, run] = useBusy();
  const set = (k: keyof typeof form, v: string) => {
    setForm({ ...form, [k]: v });
    setConfirmed(false);
  };

  // The same checks the server makes, against what this PC knows.
  const similar: Patient[] =
    form.firstName && form.fatherName
      ? view.patients.filter(
          (p) =>
            (form.phone && p.phone && digits(p.phone) === digits(form.phone)) ||
            (norm(p.firstName) === norm(form.firstName) && norm(p.fatherName) === norm(form.fatherName)),
        )
      : [];
  const valid = form.firstName.trim() && form.fatherName.trim() && (form.age === "" || /^\d{1,3}$/.test(form.age));

  const submit = () =>
    run(async () => {
      const p = await registerPatient(userId, {
        firstName: form.firstName.trim(),
        fatherName: form.fatherName.trim(),
        grandfather: form.grandfather?.trim() || undefined,
        sex: form.sex,
        ageYears: form.age ? Number(form.age) : undefined,
        phone: form.phone?.trim() || undefined,
        confirmDuplicate: confirmed,
      });
      setForm({ ...empty, age: "" });
      setConfirmed(false);
      if (checkInNow) onRegistered(p as QueuePatient);
    });

  return (
    <Card title={<span className="flex items-center gap-2"><UserPlus aria-hidden className="size-4" /> Register a new patient</span>} description="The card number (MRN) is given when this is sent to the server.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && (!similar.length || confirmed)) void submit();
        }}
        className="grid gap-3 sm:grid-cols-3"
      >
        {(["firstName", "fatherName", "grandfather"] as const).map((k) => (
          <label key={k} className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-slate-500">{k === "firstName" ? "First name *" : k === "fatherName" ? "Father's name *" : "Grandfather's name"}</span>
            <input value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={inputClass} required={k !== "grandfather"} />
          </label>
        ))}
        <fieldset className="space-y-1 text-sm">
          <legend className="text-xs font-medium text-slate-500">Sex *</legend>
          <div className="flex gap-4 pt-2">
            {(["FEMALE", "MALE"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="radio" name="sex" checked={form.sex === s} onChange={() => set("sex", s)} /> {s === "FEMALE" ? "Female" : "Male"}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">Age (years)</span>
          <input inputMode="numeric" value={form.age} onChange={(e) => set("age", e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">Phone</span>
          <input inputMode="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className={inputClass} />
        </label>

        {similar.length > 0 && (
          <div className="sm:col-span-3">
            <Notice tone="warning">
              <p className="font-medium">This may be someone who already has a card:</p>
              <ul className="mt-2 space-y-1.5">
                {similar.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <PatientLine p={p} />
                    <button type="button" onClick={() => onUseExisting(p)} className={`${secondaryButtonClass} btn-size`}>
                      Use this card
                    </button>
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex items-center gap-2">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> This is a different person: register anyway
              </label>
            </Notice>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} /> Check in now
          </label>
          <button disabled={busy || !valid || (similar.length > 0 && !confirmed)} className={buttonClass}>
            Register
          </button>
        </div>
      </form>
    </Card>
  );
}

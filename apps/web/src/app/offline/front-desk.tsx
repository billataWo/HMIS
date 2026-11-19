"use client";

import { Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { useT } from "@/components/lang-provider";
import { Badge, buttonClass, Card, inputClass, Notice, secondaryButtonClass } from "@/components/ui";
import type { QueuePatient, Service } from "@/lib/api";
import { CANCEL_REASONS } from "@/lib/cancel-reasons";
import { checkIn, type NewPatient, registerPatient, setStatus } from "@/lib/offline/actions";
import type { OfflinePatient } from "@/lib/offline/types";
import type { OfflineVisit } from "@/lib/offline/view";
import { fullName, PatientLine, type TabProps, TriageDot, useBusy } from "./shared";

const norm = (s: string) => s.trim().toLowerCase();
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Addis_Ababa" });
const digits = (s: string) => s.replace(/\D/g, "").slice(-9);

export function FrontDesk({ view, userId }: TabProps) {
  const t = useT();
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
        // The card numbers of records merged into this one find them too (that is the number on their card).
        const hay = norm(`${p.mrn} ${(p.oldMrns ?? []).join(" ")} ${p.firstName} ${p.fatherName} ${p.grandfather ?? ""} ${p.phone ?? ""} ${p.firstNameAm ?? ""} ${p.fatherNameAm ?? ""}`);
        const phone = p.phone ? digits(p.phone) : "";
        return words.every((w) => hay.includes(w) || (digits(w).length >= 6 && phone.endsWith(digits(w))));
      })
      .slice(0, 12);
  }, [q, view.patients]);
  const waitingIds = new Set(view.queue.filter((v) => v.status !== "COMPLETED" && v.status !== "CANCELLED").map((v) => v.patient.id));

  const doCheckIn = (p: QueuePatient) =>
    run(async () => {
      await checkIn(userId, p, service);
      setDone(t("{name} is checked in.", { name: fullName(p) }));
      setQ("");
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Card
          title={t("Check in a patient")}
          description={
            view.patientListAt
              ? t("All {n} of the clinic's patients as of {time}, and those registered here offline.", { n: view.patients.length, time: when(view.patientListAt) })
              : t("Patients known on this PC: registered recently, seen today, or registered here offline.")
          }
        >
          <div className="flex flex-wrap gap-3">
            <label className="relative min-w-0 flex-1 basis-64">
              <span className="sr-only">{t("Search patients")}</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Name, phone or MRN")} className={`${inputClass} pl-9`} />
            </label>
            <label className="basis-56">
              <span className="sr-only">{t("Service")}</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputClass}>
                <option value="">{t("No fee")}</option>
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
                    <Badge tone="info">{t("In today's queue")}</Badge>
                  ) : (
                    <button disabled={busy} onClick={() => doCheckIn(p)} className={`${secondaryButtonClass} btn-size`}>
                      {t("Check in")}
                    </button>
                  )}
                </li>
              ))}
              {!found.length && (
                <li className="py-3 text-sm text-slate-500">
                  {t("Not on this PC. Register below; if the patient already has a card, the server will say so when this is sent.")}
                </li>
              )}
            </ul>
          )}
        </Card>

        <RegisterForm view={view} userId={userId} onRegistered={(p) => doCheckIn(p)} onUseExisting={(p) => doCheckIn(p)} />
      </div>

      <Card title={t("Today's queue")}>
        <ol className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {view.queue.map((v) => (
            <QueueRow key={v.id} visit={v} userId={userId} />
          ))}
          {!view.queue.length && <li className="py-3 text-sm text-slate-500">{t("Nobody yet.")}</li>}
        </ol>
      </Card>
    </div>
  );
}

/** One visit in today's queue; a waiting one can be cancelled, with the reason (as in HMIS). */
function QueueRow({ visit: v, userId }: { visit: OfflineVisit; userId: string }) {
  const t = useT();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number]["value"]>("LEFT_WITHOUT_BEING_SEEN");
  const [busy, run] = useBusy();
  return (
    <li className="py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block w-7 shrink-0 font-mono text-slate-500 tabular-nums">{v.offline ? "·" : v.queueNumber}</span>
          <TriageDot level={v.triageLevel} />
          <span className="truncate">{fullName(v.patient)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {v.offline && v.status === "WAITING" ? <Badge tone="violet">{t("Offline")}</Badge> : <StatusBadge status={v.status} lang={t.lang} />}
          {v.status === "WAITING" && !cancelling && (
            <button onClick={() => setCancelling(true)} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              {t("Cancel")}
            </button>
          )}
        </span>
      </div>
      {cancelling && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} aria-label={t("Why the visit is cancelled")} className={`${inputClass} min-w-0 flex-1`}>
            {CANCEL_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {t(r.label)}
              </option>
            ))}
          </select>
          <button disabled={busy} onClick={() => run(async () => (await setStatus(userId, v, "CANCELLED", reason), setCancelling(false)))} className={`${secondaryButtonClass} btn-size`}>
            {t("Cancel the visit")}
          </button>
          <button onClick={() => setCancelling(false)} className="text-xs text-slate-500 hover:underline">
            {t("Keep")}
          </button>
        </div>
      )}
    </li>
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
  const t = useT();
  const set = (k: keyof typeof form, v: string) => {
    setForm({ ...form, [k]: v });
    setConfirmed(false);
  };

  // The same checks the server makes, against what this PC knows.
  const similar: OfflinePatient[] =
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
    <Card
      title={
        <span className="flex items-center gap-2">
          <UserPlus aria-hidden className="size-4" /> {t("Register a new patient")}
        </span>
      }
      description={t("The card number (MRN) is given when this is sent to the server.")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && (!similar.length || confirmed)) void submit();
        }}
        className="grid gap-3 sm:grid-cols-3"
      >
        {(["firstName", "fatherName", "grandfather"] as const).map((k) => (
          <label key={k} className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-slate-500">{t(k === "firstName" ? "First name *" : k === "fatherName" ? "Father's name *" : "Grandfather's name")}</span>
            <input value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={inputClass} required={k !== "grandfather"} />
          </label>
        ))}
        <fieldset className="space-y-1 text-sm">
          <legend className="text-xs font-medium text-slate-500">{t("Sex *")}</legend>
          <div className="flex gap-4 pt-2">
            {(["FEMALE", "MALE"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="radio" name="sex" checked={form.sex === s} onChange={() => set("sex", s)} /> {t(s === "FEMALE" ? "Female" : "Male")}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">{t("Age (years)")}</span>
          <input inputMode="numeric" value={form.age} onChange={(e) => set("age", e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-slate-500">{t("Phone")}</span>
          <input inputMode="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className={inputClass} />
        </label>

        {similar.length > 0 && (
          <div className="sm:col-span-3">
            <Notice tone="warning">
              <p className="font-medium">{t("This may be someone who already has a card:")}</p>
              <ul className="mt-2 space-y-1.5">
                {similar.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <PatientLine p={p} />
                    <button type="button" onClick={() => onUseExisting(p)} className={`${secondaryButtonClass} btn-size`}>
                      {t("Use this card")}
                    </button>
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex items-center gap-2">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> {t("This is a different person: register anyway")}
              </label>
            </Notice>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} /> {t("Check in now")}
          </label>
          <button disabled={busy || !valid || (similar.length > 0 && !confirmed)} className={buttonClass}>
            {t("Register")}
          </button>
        </div>
      </form>
    </Card>
  );
}

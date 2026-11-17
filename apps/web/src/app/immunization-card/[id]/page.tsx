import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { api, ApiError, type ImmunizationRecord, type Me, type PatientDetail } from "@/lib/api";
import { formatDualDate, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Immunization card" };

const day = (d: string) => formatDualDate(`${d.slice(0, 10)}T12:00:00+03:00`);

/** The patient's immunization card: every dose given, and when the next ones are due. */
async function Card({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let p: PatientDetail;
  let r: ImmunizationRecord;
  let me: Me;
  try {
    [p, r, me] = await Promise.all([api<PatientDetail>(`/patients/${id}`), api<ImmunizationRecord>(`/patients/${id}/immunizations`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const next = r.schedule.find((d) => d.status === "OVERDUE" || d.status === "DUE" || d.status === "UPCOMING");
  const cell = "border border-black px-2 py-1";
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 text-sm text-black">
      <header className="border-b-2 border-black pb-2 text-center">
        <p className="text-lg font-bold">{me.tenant.name}</p>
        {me.tenant.nameAm && <p lang="am">{me.tenant.nameAm}</p>}
        <p className="mt-1 font-semibold tracking-wide">
          IMMUNIZATION CARD · <span lang="am">የክትባት ካርድ</span>
        </p>
      </header>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        <p>
          <span className="text-slate-600">Name:</span> {fullName(p)}
        </p>
        <p>
          <span className="text-slate-600">MRN:</span> {p.mrn}
        </p>
        <p>
          <span className="text-slate-600">Sex:</span> {p.sex === "MALE" ? "Male" : "Female"}
        </p>
        <p>
          <span className="text-slate-600">Born:</span> {p.dateOfBirth ? `${day(p.dateOfBirth)}${p.dobEstimated ? " (estimated)" : ""}` : "not known"}
        </p>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${cell} text-left`}>When</th>
            <th className={`${cell} text-left`}>Vaccine</th>
            <th className={`${cell} text-left`}>Given on</th>
            <th className={`${cell} text-left`}>Due</th>
          </tr>
        </thead>
        <tbody>
          {r.schedule
            .filter((d) => d.status !== "MISSED")
            .map((d, i, all) => (
              <tr key={`${d.vaccine}-${d.doseNo}`}>
                <td className={cell}>{i === 0 || all[i - 1].milestone !== d.milestone ? d.milestone : ""}</td>
                <td className={cell}>{d.label}</td>
                <td className={cell}>{d.given ? day(d.given.givenOn) : ""}</td>
                <td className={cell}>{d.given ? "" : d.waitingFor ? `after ${d.waitingFor}` : d.status === "DUE" && (d.vaccine === "TD" || d.vaccine === "HPV") ? "now" : day(d.dueOn)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {next && (
        <p className="rounded border-2 border-black p-2 font-semibold">
          {next.status === "UPCOMING" ? (
            <>
              Next: {next.label} on {day(next.dueOn)} · <span lang="am">ቀጣይ ክትባት</span>
            </>
          ) : next.status === "DUE" ? (
            <>
              Due now: {next.label} (due {day(next.dueOn)}) · <span lang="am">አሁን የሚሰጥ ክትባት</span>
            </>
          ) : (
            <>
              Late: {next.label} was due {day(next.dueOn)}. Come as soon as possible · <span lang="am">ያለፈ ክትባት</span>
            </>
          )}
        </p>
      )}
      <PrintButton />
    </div>
  );
}

export default function ImmunizationCardPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="flex-1 bg-white px-4 py-6 print:p-0">
      <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
        <Card params={params} />
      </Suspense>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { api, ApiError, type LabSendOuts, type LabWorkOrder } from "@/lib/api";
import { ageFrom, formatDualDate, formatTime, fullName, shiftDay } from "@/lib/format";
import { specimenShort } from "@/lib/specimens";

export const metadata: Metadata = { title: "Dispatch list" };

/**
 * The samples sent to reference labs on a day, one sheet per lab, for the courier to sign: what
 * left, for whom, and who handed it over and received it. `?day=YYYY-MM-DD` (default today).
 */
async function Dispatch({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day } = await searchParams;
  let d: LabSendOuts;
  try {
    d = await api<LabSendOuts>(`/lab/send-outs${day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `?day=${day}` : ""}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const byLab = new Map<string, LabWorkOrder[]>();
  for (const o of d.sent) byLab.set(o.sentTo!, [...(byLab.get(o.sentTo!) ?? []), o]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 text-sm text-black">
      <div className="space-y-2 font-sans print:hidden">
        <PrintButton />
        <p className="flex justify-center gap-4 text-xs text-slate-500">
          <Link href={`/lab-dispatch?day=${shiftDay(d.day, -1)}`} className="underline">
            ← day before
          </Link>
          <span>{formatDualDate(`${d.day}T12:00:00+03:00`)}</span>
          <Link href={`/lab-dispatch?day=${shiftDay(d.day, 1)}`} className="underline">
            day after →
          </Link>
        </p>
        {byLab.size === 0 && <p className="text-center text-slate-500">No samples were sent out on this day.</p>}
      </div>

      {[...byLab.entries()].map(([lab, orders]) => (
        <section key={lab} className="space-y-3 break-after-page last:break-after-auto">
          <header className="border-b border-black pb-2 text-center">
            <p className="text-base font-bold">{d.tenant.name}</p>
            <p className="text-xs">{[d.tenant.address, d.tenant.phone && `Tel ${d.tenant.phone}`].filter(Boolean).join(" · ")}</p>
            <p className="mt-1 font-semibold tracking-wide">SAMPLES SENT TO {lab.toUpperCase()}</p>
            <p className="text-xs">
              {formatDualDate(`${d.day}T12:00:00+03:00`)} · {orders.length} {orders.length === 1 ? "test" : "tests"}
            </p>
          </header>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-black text-xs">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Sample</th>
                <th className="py-1 pr-2">Patient</th>
                <th className="py-1 pr-2">Test</th>
                <th className="py-1 pr-2">Specimen</th>
                <th className="py-1 pr-2">Taken</th>
                <th className="py-1">Their no.</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const p = o.visit.patient;
                const age = ageFrom(p.dateOfBirth);
                return (
                  <tr key={o.id} className="border-b border-slate-300 align-top">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2 font-mono text-xs">{o.sampleId}</td>
                    <td className="py-1 pr-2">
                      {fullName(p)}
                      <span className="block text-xs">
                        {p.mrn} · {p.sex === "MALE" ? "M" : "F"}
                        {age !== null && ` · ${age}y`}
                      </span>
                    </td>
                    <td className="py-1 pr-2">
                      {o.labTest.name}
                      {o.urgent && <span className="ml-1 font-bold">URGENT</span>}
                    </td>
                    <td className="py-1 pr-2">{specimenShort(o.labTest.specimen) ?? ""}</td>
                    <td className="py-1 pr-2 text-xs whitespace-nowrap">{o.sampleCollectedAt && formatTime(o.sampleCollectedAt)}</td>
                    <td className="py-1 text-xs">{o.sentRef ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 pt-6 text-xs">
            <p className="border-t border-black pt-1">Handed over by (name, signature, time)</p>
            <p className="border-t border-black pt-1">Received by (name, signature, time)</p>
          </div>
        </section>
      ))}
    </div>
  );
}

export default function DispatchPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  return (
    <main className="flex-1 bg-white px-4 py-6 print:p-0">
      <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
        <Dispatch searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

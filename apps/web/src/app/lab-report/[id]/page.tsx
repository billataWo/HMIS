import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment, Suspense } from "react";
import { rangeText } from "@/components/lab-result";
import { api, ApiError, type LabReport } from "@/lib/api";
import { ageFrom, formatDualDate, formatTime, fullName } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Lab results" };

async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let r: LabReport;
  try {
    r = await api<LabReport>(`/visits/${id}/lab-report`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const age = ageFrom(r.patient.dateOfBirth);
  const verifiers = [...new Set(r.labOrders.map((o) => o.verifiedBy?.fullName).filter(Boolean))];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 text-sm text-black">
      <header className="border-b border-black pb-3 text-center">
        <p className="text-lg font-bold">{r.tenant.name}</p>
        {r.tenant.nameAm && <p>{r.tenant.nameAm}</p>}
        <p className="text-xs">{[r.tenant.address, r.tenant.phone && `Tel ${r.tenant.phone}`].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 font-semibold tracking-wide">LABORATORY RESULTS · የላብራቶሪ ውጤት</p>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          <span className="text-slate-600">Patient:</span> {fullName(r.patient)}
        </p>
        <p>
          <span className="text-slate-600">MRN:</span> {r.patient.mrn}
        </p>
        <p>
          <span className="text-slate-600">Sex / age:</span> {r.patient.sex === "MALE" ? "Male" : "Female"}
          {age !== null && ` · ${age} years`}
        </p>
        <p>
          <span className="text-slate-600">Visit:</span> {formatDualDate(r.checkedInAt)}
        </p>
        {r.doctor && (
          <p>
            <span className="text-slate-600">Requested by:</span> Dr. {r.doctor.fullName}
          </p>
        )}
      </div>

      {r.labOrders.length === 0 ? (
        <p>No verified results for this visit yet.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-black text-left">
              <th className="py-1 pr-2 text-slate-800">Test</th>
              <th className="py-1 pr-2 text-slate-800">Result</th>
              <th className="py-1 pr-2 text-slate-800">Flag</th>
              <th className="py-1 pr-2 text-slate-800">Reference</th>
              <th className="py-1 text-slate-800">Sample</th>
            </tr>
          </thead>
          <tbody>
            {r.labOrders.map((o) =>
              o.labTest.components?.length ? (
                // A panel: the test name, then one row per component with its own range and flag.
                <Fragment key={o.id}>
                  <tr className="align-top">
                    <td colSpan={4} className="pt-2 font-semibold">
                      {o.labTest.name}
                      {o.resultNote && <span className="block text-xs font-normal">{o.resultNote}</span>}
                    </td>
                    <td className="pt-2 font-mono text-xs">
                      {o.sampleId}
                      {o.sampleCollectedAt && <span className="block">{formatTime(o.sampleCollectedAt)}</span>}
                    </td>
                  </tr>
                  {o.labTest.components.map((c) => {
                    const v = o.values?.find((x) => x.componentId === c.id);
                    if (!v) return null;
                    const abnormal = v.flag === "H" || v.flag === "L";
                    return (
                      <tr key={c.id} className="border-b border-slate-200 align-top">
                        <td className="py-1 pr-2 pl-4">{c.name}</td>
                        <td className={`py-1 pr-2 ${abnormal ? "font-bold" : ""}`}>
                          {v.value}
                          {c.unit && ` ${c.unit}`}
                        </td>
                        <td className="py-1 pr-2 font-bold">{v.flag === "H" ? "HIGH" : v.flag === "L" ? "LOW" : ""}</td>
                        <td className="py-1 pr-2">{rangeText(c) ?? ""}</td>
                        <td />
                      </tr>
                    );
                  })}
                </Fragment>
              ) : (
              <tr key={o.id} className="border-b border-slate-300 align-top">
                <td className="py-1.5 pr-2">{o.labTest.name}</td>
                <td className={`py-1.5 pr-2 ${o.resultFlag === "H" || o.resultFlag === "L" ? "font-bold" : ""}`}>
                  {o.resultValue}
                  {o.labTest.unit && ` ${o.labTest.unit}`}
                  {o.resultNote && <span className="block text-xs font-normal">{o.resultNote}</span>}
                </td>
                <td className="py-1.5 pr-2 font-bold">{o.resultFlag === "H" ? "HIGH" : o.resultFlag === "L" ? "LOW" : ""}</td>
                <td className="py-1.5 pr-2">{rangeText(o.labTest) ?? ""}</td>
                <td className="py-1.5 font-mono text-xs">
                  {o.sampleId}
                  {o.sampleCollectedAt && <span className="block">{formatTime(o.sampleCollectedAt)}</span>}
                </td>
              </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      <footer className="flex justify-between pt-6 text-xs">
        <span>Verified by: {verifiers.join(", ") || "—"}</span>
        <span>Signature: ____________________</span>
      </footer>
      <PrintButton />
    </div>
  );
}

export default function LabReportPage({ params }: PageProps<"/lab-report/[id]">) {
  return (
    <main className="flex-1 bg-white px-4 py-6">
      <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
        <Report params={params} />
      </Suspense>
    </main>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
// i18n: english-only — certificates and referral letters go to employers and hospitals in
// English; only the Print button follows the screen's language.
import { LangBoundary } from "@/components/lang-boundary";
import { PrintButton } from "@/components/print-button";
import { api, ApiError, type ClinicalDocumentDetail } from "@/lib/api";
import { ageText, formatDualDate, fullName, shiftDay } from "@/lib/format";

export const metadata: Metadata = { title: "Medical document" };

const URGENCY: Record<string, string> = { ROUTINE: "Routine", URGENT: "Urgent", EMERGENCY: "Emergency" };

async function Document({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let doc: ClinicalDocumentDetail;
  try {
    doc = await api<ClinicalDocumentDetail>(`/documents/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const { visit, data } = doc;
  const p = visit.patient;
  const age = ageText(p.dateOfBirth);
  const restDays = Number(data.restDays ?? 0);
  const from = String(data.fromDate ?? "");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 text-sm leading-relaxed text-black">
      <header className="border-b border-black pb-3 text-center">
        <p className="text-lg font-bold">{visit.tenant.name}</p>
        {visit.tenant.nameAm && <p>{visit.tenant.nameAm}</p>}
        <p className="text-xs">{[visit.tenant.address, visit.tenant.phone && `Tel ${visit.tenant.phone}`].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 font-semibold tracking-wide">
          {doc.type === "MEDICAL_CERTIFICATE" ? "MEDICAL CERTIFICATE · የሕክምና ማስረጃ" : "REFERRAL LETTER · የሪፈራል ደብዳቤ"}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <p>
          <span className="text-slate-600">Patient:</span> {fullName(p)}
        </p>
        <p>
          <span className="text-slate-600">MRN:</span> {p.mrn}
        </p>
        <p>
          <span className="text-slate-600">Sex / age:</span> {p.sex === "MALE" ? "Male" : "Female"}
          {age !== null && ` · ${age}`}
        </p>
        <p>
          <span className="text-slate-600">Seen on:</span> {formatDualDate(visit.checkedInAt)}
        </p>
        <p>
          <span className="text-slate-600">Issued:</span> {formatDualDate(doc.createdAt)}
        </p>
        <p>
          <span className="text-slate-600">Ref.:</span> {doc.id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      {doc.type === "MEDICAL_CERTIFICATE" ? (
        <section className="space-y-3">
          <p>
            This is to certify that the above patient was examined at this facility and was found to have: <strong>{String(data.diagnosis)}</strong>.
          </p>
          {restDays > 0 ? (
            <p>
              The patient is advised to rest for <strong>{restDays} day{restDays === 1 ? "" : "s"}</strong>, from {formatDualDate(`${from}T12:00:00+03:00`)} to{" "}
              {formatDualDate(`${shiftDay(from, restDays - 1)}T12:00:00+03:00`)}.
            </p>
          ) : (
            <p>The patient is fit to return to work or school.</p>
          )}
          {data.remarks && <p>Remarks: {String(data.remarks)}</p>}
        </section>
      ) : (
        <section className="space-y-3">
          <p>
            <span className="text-slate-600">To:</span> <strong>{String(data.to)}</strong> · Urgency: <strong>{URGENCY[String(data.urgency)] ?? String(data.urgency)}</strong>
          </p>
          <p>Dear colleague, I am referring the above patient for: {String(data.reason)}.</p>
          <div>
            <p className="font-semibold">History and findings</p>
            <p className="whitespace-pre-wrap">{String(data.summary)}</p>
          </div>
          {visit.diagnoses.length > 0 && (
            <div>
              <p className="font-semibold">Diagnosis</p>
              <p>{visit.diagnoses.map((d) => `${d.label} (ICD-11 ${d.icd11Code})`).join("; ")}</p>
            </div>
          )}
          {data.treatmentGiven && (
            <div>
              <p className="font-semibold">Treatment given</p>
              <p className="whitespace-pre-wrap">{String(data.treatmentGiven)}</p>
            </div>
          )}
          <p>Thank you for seeing this patient.</p>
        </section>
      )}

      <footer className="flex justify-between pt-10 text-xs">
        <span>Dr. {String(data.issuedBy ?? "")}</span>
        <span>Signature and stamp: ____________________</span>
      </footer>
      <LangBoundary>
        <PrintButton />
      </LangBoundary>
    </div>
  );
}

export default function DocumentPage({ params }: PageProps<"/document/[id]">) {
  return (
    <main className="flex-1 bg-white px-4 py-6">
      <Suspense fallback={<p className="text-center text-sm">…</p>}>
        <Document params={params} />
      </Suspense>
    </main>
  );
}

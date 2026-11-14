import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { api, ApiError, type VisitSummary } from "@/lib/api";
import { directions } from "@/lib/directions";
import { ageText, countOf, formatDualDate, formatTime, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Visit summary" };

/** When to come back at once, in English and Amharic (have a native speaker check the wording). */
const DANGER_SIGNS: [string, string][] = [
  ["Difficulty breathing", "የመተንፈስ ችግር"],
  ["High fever that does not come down", "የማይቀንስ ከፍተኛ ትኩሳት"],
  ["Fits (convulsions) or very hard to wake", "መንቀጥቀጥ ወይም ለመንቃት መቸገር"],
  ["Cannot drink, or vomits everything", "መጠጣት አለመቻል ወይም የበላውን ሁሉ ማስመለስ"],
  ["Bleeding", "ደም መፍሰስ"],
  ["Severe pain, or feeling much worse", "ከባድ ሕመም ወይም ሁኔታው መባባስ"],
];

function Heading({ en, am }: { en: string; am: string }) {
  return (
    <h2 className="border-b border-black pb-0.5 text-sm font-bold">
      {en} · <span lang="am">{am}</span>
    </h2>
  );
}

/**
 * What the patient takes home from a consultation, in English and Amharic: their diagnosis, how
 * to take each medicine, the tests and results, the doctor's advice, the next appointment, and the
 * danger signs that mean coming back at once.
 */
async function Summary({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let s: VisitSummary;
  try {
    s = await api<VisitSummary>(`/visits/${id}/summary`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403 || e.status === 409)) notFound();
    throw e;
  }
  const age = ageText(s.patient.dateOfBirth);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 text-sm text-black">
      <header className="border-b-2 border-black pb-2 text-center">
        <p className="text-lg font-bold">{s.tenant.name}</p>
        {s.tenant.nameAm && <p lang="am">{s.tenant.nameAm}</p>}
        <p className="text-xs">{[s.tenant.address, s.tenant.phone && `Tel ${s.tenant.phone}`].filter(Boolean).join(" · ")}</p>
        <p className="mt-1 font-semibold tracking-wide">
          VISIT SUMMARY · <span lang="am">የሕክምና ማጠቃለያ</span>
        </p>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        <p>
          <span className="text-slate-600">Patient:</span> {fullName(s.patient)}
        </p>
        <p>
          <span className="text-slate-600">MRN:</span> {s.patient.mrn}
        </p>
        <p>
          <span className="text-slate-600">Sex / age:</span> {s.patient.sex === "MALE" ? "Male" : "Female"}
          {age !== null && ` · ${age}`}
        </p>
        <p>
          <span className="text-slate-600">Date:</span> {formatDualDate(s.checkedInAt)}
        </p>
        {s.doctor && (
          <p>
            <span className="text-slate-600">Doctor:</span> Dr. {s.doctor.fullName}
          </p>
        )}
      </div>

      {s.diagnoses.length > 0 && (
        <section className="space-y-1">
          <Heading en="Diagnosis" am="ምርመራ" />
          <ul className="list-disc pl-5">
            {s.diagnoses.map((d) => (
              <li key={d.icd11Code}>{d.label}</li>
            ))}
          </ul>
        </section>
      )}

      {s.medicines.length > 0 && (
        <section className="space-y-1">
          <Heading en="Your medicines" am="መድኃኒቶችዎ" />
          <ul className="space-y-1.5">
            {s.medicines.map((m, i) => {
              const d = directions(m);
              return (
                <li key={i}>
                  <p className="font-semibold">
                    {[m.drug.genericName, m.drug.strength, m.drug.form].filter(Boolean).join(" ")}{" "}
                    <span className="font-normal">
                      ({countOf(m.quantity, m.drug.unit)})
                    </span>
                  </p>
                  <p>{d.en}</p>
                  <p lang="am">{d.am}</p>
                  {m.instructions && <p className="text-xs">{m.instructions}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {s.labOrders.length > 0 && (
        <section className="space-y-1">
          <Heading en="Tests" am="የላብራቶሪ ምርመራዎች" />
          <ul className="list-disc pl-5">
            {s.labOrders.map((o, i) => (
              <li key={i}>
                {o.labTest.name}:{" "}
                {o.status === "VERIFIED" ? (
                  <>
                    {o.resultValue}
                    {o.labTest.unit && ` ${o.labTest.unit}`}
                    {o.resultFlag && o.resultFlag !== "N" && <span className="font-bold"> ({o.resultFlag === "H" || o.resultFlag === "HH" ? "high" : "low"})</span>}
                  </>
                ) : (
                  <span className="text-slate-600">result not ready yet</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.patientAdvice && (
        <section className="space-y-1">
          <Heading en="Advice" am="ምክር" />
          <p className="whitespace-pre-wrap">{s.patientAdvice}</p>
        </section>
      )}

      <section className="space-y-1">
        <Heading en="Next appointment" am="ቀጣይ ቀጠሮ" />
        {s.nextAppointment ? (
          <p className="font-semibold">
            {formatDualDate(s.nextAppointment.scheduledAt)} at {formatTime(s.nextAppointment.scheduledAt)}
            {s.nextAppointment.doctor && ` · Dr. ${s.nextAppointment.doctor.fullName}`}
            {s.nextAppointment.reason && <span className="font-normal"> · {s.nextAppointment.reason}</span>}
          </p>
        ) : (
          <p>None booked. Come back if you are not better.</p>
        )}
      </section>

      <section className="space-y-1 rounded border-2 border-black p-2">
        <h2 className="text-sm font-bold">
          Come back at once if · <span lang="am">ወዲያውኑ ይመለሱ፦</span>
        </h2>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
          {DANGER_SIGNS.map(([en, am]) => (
            <li key={en}>
              • {en} · <span lang="am">{am}</span>
            </li>
          ))}
        </ul>
      </section>

      <PrintButton />
    </div>
  );
}

export default function VisitSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="flex-1 bg-white px-4 py-6 print:p-0">
      <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
        <Summary params={params} />
      </Suspense>
    </main>
  );
}

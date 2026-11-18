import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
// i18n: english-only — the printed card the mother keeps is laid out in English with its Amharic
// headings; only the Print button follows the screen's language.
import { LangBoundary } from "@/components/lang-boundary";
import { PrintButton } from "@/components/print-button";
import { api, ApiError, type Me, type Pregnancy, type QueuePatient } from "@/lib/api";
import { DANGER_SIGNS, TEST_RESULT, URINE_PROTEIN } from "@/lib/anc";
import { ageText, formatDualDate, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "ANC card" };

const day = (d: string) => formatDualDate(`${d.slice(0, 10)}T12:00:00+03:00`);

/** The mother's antenatal card: her pregnancy, every contact, the next one, and the danger signs. */
async function Card({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let p: Pregnancy & { patient: QueuePatient };
  let me: Me;
  try {
    [p, me] = await Promise.all([api<Pregnancy & { patient: QueuePatient }>(`/pregnancies/${id}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const cell = "border border-black px-1.5 py-1";
  const test = (v: string | null) => (v ? (TEST_RESULT[v] ?? v) : "");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 text-sm text-black">
      <header className="border-b-2 border-black pb-2 text-center">
        <p className="text-lg font-bold">{me.tenant.name}</p>
        {me.tenant.nameAm && <p lang="am">{me.tenant.nameAm}</p>}
        <p className="mt-1 font-semibold tracking-wide">
          ANTENATAL CARE CARD · <span lang="am">የቅድመ ወሊድ ክትትል ካርድ</span>
        </p>
      </header>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        <p>
          <span className="text-slate-600">Name:</span> {fullName(p.patient)}
        </p>
        <p>
          <span className="text-slate-600">MRN:</span> {p.patient.mrn}
        </p>
        <p>
          <span className="text-slate-600">Age:</span> {ageText(p.patient.dateOfBirth) ?? "not known"}
        </p>
        <p>
          <span className="text-slate-600">G / P:</span> G{p.gravida} P{p.para}
          {p.bloodGroup && ` · blood group ${p.bloodGroup}`}
        </p>
        <p>
          <span className="text-slate-600">Last period:</span> {day(p.lmp)}
        </p>
        <p>
          <span className="text-slate-600">Due date:</span> <strong>{day(p.edd)}</strong>
        </p>
      </div>
      {p.risks.length > 0 && (
        <p>
          <span className="font-semibold">Risks:</span> {p.risks.map((r) => r.label).join("; ")}
        </p>
      )}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {["#", "Date", "Weeks", "BP", "Weight", "Fundus", "FHR", "Protein", "Hb", "Syphilis", "HIV", "Next"].map((h) => (
              <th key={h} className={`${cell} text-left`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.contacts.filter((c) => !c.voidedAt).map((c) => (
            <tr key={c.id}>
              <td className={cell}>{c.contactNo}</td>
              <td className={cell}>{day(c.contactOn)}</td>
              <td className={cell}>{c.gaWeeks}</td>
              <td className={cell}>{c.systolicBp ? `${c.systolicBp}/${c.diastolicBp ?? ""}` : ""}</td>
              <td className={cell}>{c.weightKg ? Number(c.weightKg) : ""}</td>
              <td className={cell}>{c.fundalHeightCm ?? ""}</td>
              <td className={cell}>{c.fetalHeartRate ?? ""}</td>
              <td className={cell}>{c.urineProtein ? URINE_PROTEIN[c.urineProtein] : ""}</td>
              <td className={cell}>{c.hb ? Number(c.hb) : ""}</td>
              <td className={cell}>{test(c.syphilis)}</td>
              <td className={cell}>{test(c.hiv)}</td>
              <td className={cell}>{day(c.nextContactOn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.nextContactOn && (
        <p className="rounded border-2 border-black p-2 font-semibold">
          Next contact: {day(p.nextContactOn)} · <span lang="am">ቀጣይ ቀጠሮ</span>
        </p>
      )}
      <section className="space-y-1 rounded border-2 border-black p-2">
        <h2 className="text-sm font-bold">
          Come at once if · <span lang="am">ወዲያውኑ ይምጡ፦</span>
        </h2>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
          {Object.values(DANGER_SIGNS).map((s) => (
            <li key={s}>• {s}</li>
          ))}
        </ul>
      </section>
      <LangBoundary>
        <PrintButton />
      </LangBoundary>
    </div>
  );
}

export default function AncCardPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="flex-1 bg-white px-4 py-6 print:p-0">
      <Suspense fallback={<p className="text-center text-sm">…</p>}>
        <Card params={params} />
      </Suspense>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { LangBoundary } from "@/components/lang-boundary";
import { PrintButton } from "@/components/print-button";
import { getT } from "@/lib/lang";
import { api, ApiError, type Me, type PatientDetail } from "@/lib/api";
import { ageText, formatDualDate, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Patient card" };

/**
 * The patient's card, credit-card size (85.6 × 54 mm) for a card or label printer, or `?sheet=1`
 * on A4 to cut out. The QR code holds the MRN: scanned into any patient search, it finds them.
 */
async function Card({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string }> }) {
  const [{ id }, { sheet }, t] = await Promise.all([params, searchParams, getT()]);
  let p: PatientDetail;
  let me: Me;
  try {
    [p, me] = await Promise.all([api<PatientDetail>(`/patients/${id}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const qr = `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(p.mrn, { type: "svg", margin: 0, errorCorrectionLevel: "M" })).toString("base64")}`;
  const onSheet = sheet === "1";
  const nameAm = [p.firstNameAm, p.fatherNameAm].filter(Boolean).join(" ");
  const born = p.dateOfBirth && !p.dobEstimated ? formatDualDate(p.dateOfBirth) : null;
  const age = ageText(p.dateOfBirth);

  return (
    <div className="mx-auto w-[85.6mm] space-y-4 print:w-auto">
      {!onSheet && <style>{"@page { size: 85.6mm 54mm; margin: 0; }"}</style>}
      <div className="space-y-2 font-sans text-sm print:hidden">
        <PrintButton />
        <p className="text-center text-xs text-slate-500">
          {onSheet ? (
            <Link href={`/patient-card/${id}`} className="underline">
              {t("card printer (one card per page)")}
            </Link>
          ) : (
            <Link href={`/patient-card/${id}?sheet=1`} className="underline">
              {t("on an A4 sheet to cut out")}
            </Link>
          )}
        </p>
      </div>
      <article
        className={`flex h-[54mm] w-[85.6mm] flex-col overflow-hidden bg-white p-[3mm] font-sans text-[8pt] leading-tight text-black ${
          onSheet ? "border border-dashed border-slate-400" : "rounded-[3mm] border border-slate-300 print:rounded-none print:border-0"
        }`}
      >
        <header className="border-b border-black pb-[1mm] text-center">
          <p className="truncate text-[9pt] font-bold">{me.tenant.name}</p>
          {me.tenant.nameAm && (
            <p lang="am" className="truncate">
              {me.tenant.nameAm}
            </p>
          )}
          {/* i18n-ignore: the printed card is in both languages */}
          <p className="text-[6.5pt] font-semibold tracking-wide">
            PATIENT CARD · <span lang="am">የታካሚ ካርድ</span>
          </p>
        </header>
        <div className="flex min-h-0 flex-1 gap-[2.5mm] pt-[1.5mm]">
          <div className="flex min-w-0 flex-1 flex-col gap-[0.6mm]">
            <p className="truncate text-[10pt] font-bold">{fullName(p)}</p>
            {nameAm && (
              <p lang="am" className="truncate text-[9pt]">
                {nameAm}
              </p>
            )}
            <p className="font-mono text-[12pt] font-bold tracking-wide">{p.mrn}</p>
            <p className="truncate">
              {/* i18n-ignore: both languages on the card */}
              {p.sex === "MALE" ? "Male · ወንድ" : "Female · ሴት"}
              {age && ` · ${age}`}
            </p>
            {/* i18n-ignore: printed card, English words with the numbers */}
            {born && <p className="truncate">Born {born}</p>}
            {/* i18n-ignore */}
            {p.phone && <p className="truncate">Tel {p.phone}</p>}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URI, printed */}
          <img src={qr} alt={`QR code: ${p.mrn}`} className="size-[22mm] shrink-0 self-center" />
        </div>
        <p className="border-t border-black pt-[0.8mm] text-center text-[6.5pt]">
          {/* i18n-ignore: both languages */}
          Bring this card to every visit · <span lang="am">በእያንዳንዱ ጉብኝት ይዘው ይምጡ</span>
        </p>
      </article>
    </div>
  );
}

export default function PatientCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string }> }) {
  return (
    <main className="flex-1 bg-white px-4 py-6 print:p-0">
      <Suspense fallback={<p className="text-center text-sm">…</p>}>
        <LangBoundary>
          <Card params={params} searchParams={searchParams} />
        </LangBoundary>
      </Suspense>
    </main>
  );
}

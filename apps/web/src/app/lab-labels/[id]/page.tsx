import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { api, ApiError, type LabLabels } from "@/lib/api";
import { ageFrom, fullName } from "@/lib/format";
import { specimenShort } from "@/lib/specimens";

export const metadata: Metadata = { title: "Sample labels" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Addis_Ababa" });

/**
 * One label per sample tube or container, 50 × 25 mm for tube-label printers (each label its own
 * page); `?sheet=1` puts them on one A4 sheet to cut out, `?sample=` prints just that tube. The QR
 * code holds the sample number, for scanners and phones.
 */
async function Labels({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string; sample?: string }> }) {
  const [{ id }, { sheet, sample }] = await Promise.all([params, searchParams]);
  let data: LabLabels;
  try {
    data = await api<LabLabels>(`/visits/${id}/lab-labels`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const tubes = sample ? data.tubes.filter((t) => t.sampleId === sample) : data.tubes;
  const qr = await Promise.all(
    tubes.map(async (t) => `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(t.sampleId, { type: "svg", margin: 0, errorCorrectionLevel: "M" })).toString("base64")}`),
  );
  const p = data.patient;
  const age = ageFrom(p.dateOfBirth);
  const onSheet = sheet === "1";
  const here = `/lab-labels/${id}${sample ? `?sample=${encodeURIComponent(sample)}` : ""}`;

  return (
    <div className={`mx-auto space-y-4 ${onSheet ? "max-w-[190mm]" : "w-[50mm]"} print:max-w-none`}>
      {/* A label printer takes one 50 × 25 mm label per page. */}
      {!onSheet && <style>{"@page { size: 50mm 25mm; margin: 0; }"}</style>}
      <div className="space-y-2 font-sans text-sm print:hidden">
        <PrintButton />
        <p className="text-center text-xs text-slate-500">
          {tubes.length} {tubes.length === 1 ? "label" : "labels"} ·{" "}
          {onSheet ? (
            <Link href={here} className="underline">
              one per label (label printer)
            </Link>
          ) : (
            <Link href={`${here}${sample ? "&" : "?"}sheet=1`} className="underline">
              all on one A4 sheet
            </Link>
          )}
        </p>
        {tubes.length === 0 && <p className="text-center text-xs text-slate-500">No samples taken yet.</p>}
      </div>
      <div className={onSheet ? "flex flex-wrap gap-2" : ""}>
        {tubes.map((t, i) => (
          <article
            key={t.sampleId}
            className={`flex h-[25mm] w-[50mm] gap-1.5 overflow-hidden bg-white p-[1.5mm] font-sans text-[7.5pt] leading-[1.15] text-black ${
              onSheet ? "border border-dashed border-slate-400 break-inside-avoid" : "border border-slate-300 break-after-page last:break-after-auto print:border-0"
            }`}
          >
            <span className="flex w-[15mm] shrink-0 flex-col items-center justify-between">
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URI, printed */}
              <img src={qr[i]} alt={`QR code: ${t.sampleId}`} className="size-[15mm]" />
              {t.urgent && <span className="w-full bg-black text-center text-[6.5pt] font-bold text-white">URGENT</span>}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[8pt] font-bold">{fullName(p)}</span>
              <span className="truncate">
                {p.mrn} · {p.sex === "MALE" ? "M" : "F"}
                {age !== null && ` · ${age}y`}
              </span>
              <span className="truncate font-mono text-[8.5pt] font-bold">{t.sampleId}</span>
              <span className="truncate">{specimenShort(t.specimen) ?? "Sample"}</span>
              <span className="line-clamp-2">{t.tests.join(", ")}</span>
              <span className="mt-auto truncate text-[6.5pt]">
                {t.collectedAt && when(t.collectedAt)} · {data.tenant.name}
              </span>
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function SampleLabelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string; sample?: string }> }) {
  return (
    <main className="flex-1 bg-white px-4 py-6 print:p-0">
      <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
        <Labels params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { api, ApiError, type RxLabel } from "@/lib/api";
import { directions } from "@/lib/directions";
import { ageText, formatDualDate, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Medicine labels" };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Addis_Ababa" });

/**
 * One label per drug, sized for 72 mm label printers (each label its own page); `?sheet=1` puts
 * them all on one A4 sheet to cut out.
 */
async function Labels({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string }> }) {
  const [{ id }, { sheet }] = await Promise.all([params, searchParams]);
  let p: RxLabel;
  try {
    p = await api<RxLabel>(`/prescriptions/${id}/label`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const anyGiven = p.items.some((i) => i.dispensedQty > 0);
  // Once dispensing has started, label what was handed over; before that, what will be.
  const items = anyGiven ? p.items.filter((i) => i.dispensedQty > 0) : p.items;
  const pt = p.visit.patient;
  const age = ageText(pt.dateOfBirth, true);
  const onSheet = sheet === "1";

  return (
    <div className="mx-auto w-full max-w-[72mm] space-y-4 print:max-w-none">
      <div className="space-y-2 font-sans text-sm print:hidden">
        <PrintButton />
        <p className="text-center text-xs text-slate-500">
          {items.length} {items.length === 1 ? "label" : "labels"} ·{" "}
          {onSheet ? (
            <Link href={`/rx-label/${id}`} className="underline">
              one per label (label printer)
            </Link>
          ) : (
            <Link href={`/rx-label/${id}?sheet=1`} className="underline">
              all on one A4 sheet
            </Link>
          )}
        </p>
      </div>
      {items.map((i) => {
        const d = directions(i);
        const qty = anyGiven ? i.dispensedQty : i.quantity;
        return (
          <article
            key={i.id}
            className={`w-[72mm] space-y-1.5 border border-black p-2.5 font-sans text-[11px] leading-snug text-black ${onSheet ? "mb-3 break-inside-avoid" : "break-after-page last:break-after-auto"}`}
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-black pb-1">
              <span className="font-bold">{p.tenant.name}</span>
              {p.tenant.phone && <span className="whitespace-nowrap">Tel {p.tenant.phone}</span>}
            </header>
            <p>
              <span className="font-bold">{fullName(pt)}</span> · {pt.mrn}
              {age !== null && ` · ${age}`}
            </p>
            <p className="text-[13px] font-bold">
              {i.drug.genericName} {i.drug.strength} {i.drug.form}
              {i.drug.brandName && <span className="font-normal"> ({i.drug.brandName})</span>}
            </p>
            <p>
              Qty: <span className="font-bold">{qty}</span> {i.drug.unit}
            </p>
            <div className="rounded-sm bg-black/5 px-1.5 py-1 print:bg-transparent print:px-0">
              <p className="text-[12px] font-bold">{d.en}</p>
              <p className="text-[12px] font-bold">{d.am}</p>
              {i.instructions && <p>{i.instructions}</p>}
            </div>
            {(i.batches.length > 0 || i.expiresAt) && (
              <p>
                {i.batches.length > 0 && `Batch ${i.batches.join(", ")}`}
                {i.expiresAt && ` · Exp ${day(i.expiresAt)}`}
              </p>
            )}
            <p>
              {formatDualDate(p.dispensedAt ?? p.createdAt)}
              {p.visit.kind !== "WALK_IN" && ` · Dr. ${p.prescriber.fullName}`}
              {p.dispensedBy && ` · Disp. ${p.dispensedBy}`}
            </p>
            <p className="border-t border-black pt-1 text-center font-bold">Keep out of reach of children · ከሕፃናት እጅ በማይደርስበት ቦታ ያስቀምጡ</p>
          </article>
        );
      })}
    </div>
  );
}

export default function LabelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string }> }) {
  return (
    <main className="flex-1 bg-white px-4 py-6 print:p-0">
      <Suspense fallback={<p className="text-center text-sm">Loading…</p>}>
        <Labels params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

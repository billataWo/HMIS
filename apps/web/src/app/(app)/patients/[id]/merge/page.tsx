import { ArrowRight, Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { inputClass, linkClass, Notice, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { formatAddress } from "@/lib/address";
import { api, ApiError, type Me, type Patient, type PatientDetail } from "@/lib/api";
import { ageText, formatDualDate, fullName } from "@/lib/format";
import { MergeForm } from "./merge-form";

export const metadata: Metadata = { title: "Merge a duplicate" };

type Search = { q?: string; dup?: string };

async function load(id: string) {
  try {
    return await api<PatientDetail>(`/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

/** One record's facts, side by side with the other's. */
function Facts({ p, title }: { p: PatientDetail; title: string }) {
  const rows: [string, string | null][] = [
    ["MRN", p.mrn],
    ["Sex", p.sex === "MALE" ? "Male" : "Female"],
    ["Age", ageText(p.dateOfBirth) && `${ageText(p.dateOfBirth)}${p.dobEstimated ? " (estimated)" : ` · born ${formatDualDate(p.dateOfBirth!)}`}`],
    ["Phone", p.phone],
    ["National ID", p.nationalId ?? null],
    ["Address", formatAddress(p)],
    ["Allergies", p.allergies.join(", ") || null],
    ["Visits", p.visits.length >= 20 ? "20 or more" : String(p.visits.length)],
    ["Registered", formatDualDate(p.createdAt)],
  ];
  return (
    <section className="surface flex-1 p-4 text-sm dark:border-slate-800">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
      <p className="mt-1 text-base font-semibold">{fullName(p)}</p>
      <dl className="mt-2 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="col-span-2 break-words">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Merging a duplicate record into this one (admins): find the duplicate, compare the two, confirm.
 * Its visits, appointments, bills, coverages and problems move here; the duplicate's MRN keeps
 * finding this record.
 */
async function Merge({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, { q = "", dup }] = await Promise.all([params, searchParams]);
  const me = await api<Me>("/auth/me");
  if (me.role !== "ADMIN") return <Notice tone="info">Only clinic admins can merge patient records.</Notice>;
  const keep = await load(id);
  if (keep.mergedIntoId) redirect(`/patients/${keep.mergedIntoId}`);
  const other = dup ? await load(dup) : null;
  const matches = q && !other ? (await api<Patient[]>(`/patients?q=${encodeURIComponent(q)}&take=10`)).filter((p) => p.id !== id) : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Keeping <strong>{fullName(keep)}</strong> ({keep.mrn}). Find the duplicate record of the same person: its history moves here and its MRN keeps finding this
        record.
      </p>
      {!other && (
        <>
          <Form action={`/patients/${id}/merge`} className="flex max-w-xl gap-2">
            <div className="relative flex-1">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input name="q" defaultValue={q || keep.fatherName} placeholder="Name, phone or MRN" aria-label="Find the duplicate" className={`${inputClass} pl-9`} />
            </div>
            <button className={secondaryButtonClass}>Find</button>
          </Form>
          {q && (
            <ul className="surface max-w-xl divide-y divide-slate-100 text-sm dark:divide-slate-800 dark:border-slate-800">
              {matches.length === 0 && <li className="p-3 text-slate-500">No other record matches.</li>}
              {matches.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="font-medium">{fullName(p)}</span>
                    <span className="text-slate-500">
                      {" "}
                      · {p.mrn}
                      {ageText(p.dateOfBirth, true) && ` · ${ageText(p.dateOfBirth, true)}`}
                      {p.phone && ` · ${p.phone}`}
                    </span>
                  </span>
                  <Link href={`/patients/${id}/merge?dup=${p.id}`} className={linkClass}>
                    Compare
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {other && (
        <>
          {other.mergedIntoId ? (
            <Notice tone="warning">{other.mrn} has already been merged into another record.</Notice>
          ) : (
            <>
              <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
                <Facts p={other} title="Duplicate: merged away" />
                <ArrowRight aria-hidden className="size-5 shrink-0 self-center text-slate-400 max-md:rotate-90" />
                <Facts p={keep} title="Kept" />
              </div>
              <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                Details the kept record lacks (phone, birth date, address, next of kin, national ID) are taken from the duplicate, and the allergy lists are combined.
              </p>
              <MergeForm keeperId={keep.id} duplicateId={other.id} label={`Merge ${other.mrn} into ${keep.mrn}`} />
              <Link href={`/patients/${id}/merge`} className={`${linkClass} text-sm`}>
                Choose another record
              </Link>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function MergePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  return (
    <>
      <PageHeader title="Merge a duplicate" subtitle="ድግግሞሽ መዝገብ ማዋሃድ · one record per patient" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Merge params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

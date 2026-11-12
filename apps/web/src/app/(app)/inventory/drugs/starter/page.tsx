import Link from "next/link";
import { Suspense } from "react";
import { linkClass, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type FormularyDrug } from "@/lib/api";
import { StarterPicker } from "./starter-picker";

async function Starter() {
  let drugs: FormularyDrug[];
  try {
    drugs = await api<FormularyDrug[]>("/drugs/starter");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only pharmacists and admins manage the drug list.</p>;
    throw e;
  }
  return <StarterPicker drugs={drugs} />;
}

export default function StarterPage() {
  return (
    <>
      <PageHeader title="Add from the essential medicines list" subtitle="Tick what your clinic stocks and set your selling price" />
      <p className="mb-5 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
        Common medicines from Ethiopia&apos;s essential medicines list, with their class already filled in for the allergy and interaction checks. Check the
        strength and pack size against what your supplier sells; you can change any drug later. Not on the list?{" "}
        <Link href="/inventory/drugs/new" className={linkClass}>
          Add it by hand
        </Link>{" "}
        or{" "}
        <Link href="/inventory/drugs/import" className={linkClass}>
          import a spreadsheet
        </Link>
        .
      </p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Starter />
      </Suspense>
    </>
  );
}

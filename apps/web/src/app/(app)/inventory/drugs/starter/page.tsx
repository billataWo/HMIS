import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { linkClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type FormularyDrug } from "@/lib/api";
import { StarterPicker } from "./starter-picker";
import { NoAccess } from "@/components/status-page";

async function Starter() {
  let drugs: FormularyDrug[];
  try {
    drugs = await api<FormularyDrug[]>("/drugs/starter");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{(await getT())("Only pharmacists and admins manage the drug list.")}</NoAccess>;
    throw e;
  }
  return <StarterPicker drugs={drugs} />;
}

export default async function StarterPage() {
  const t = await getT();
  return (
    <>
      <PageTitle title="Add from the essential medicines list" subtitle="Tick what your clinic stocks and set your selling price" />
      <p className="mb-5 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
        {t.rich("Common medicines from Ethiopia's essential medicines list, with their class already filled in for the allergy and interaction checks. Check the strength and pack size against what your supplier sells; you can change any drug later. Not on the list? {hand} or {import}.", {
          hand: (
            <Link href="/inventory/drugs/new" className={linkClass}>
              {t("Add it by hand")}
            </Link>
          ),
          import: (
            <Link href="/inventory/drugs/import" className={linkClass}>
              {t("import a spreadsheet")}
            </Link>
          ),
        })}
      </p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Starter />
      </Suspense>
    </>
  );
}

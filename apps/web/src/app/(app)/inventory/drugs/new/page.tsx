import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { linkClass } from "@/components/ui";
import { getT } from "@/lib/lang";
import { DrugForm } from "../../inventory-forms";

export default async function NewDrugPage() {
  const t = await getT();
  return (
    <>
      <PageTitle title="Add drug" subtitle="New item in the clinic's drug list" />
      <p className="mb-5 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
        {t.rich("Adding many? {starter} or {import}.", {
          starter: (
            <Link href="/inventory/drugs/starter" className={linkClass}>
              {t("Pick from the essential medicines list")}
            </Link>
          ),
          import: (
            <Link href="/inventory/drugs/import" className={linkClass}>
              {t("import a spreadsheet")}
            </Link>
          ),
        })}
      </p>
      <div className="max-w-2xl">
        <DrugForm />
      </div>
    </>
  );
}

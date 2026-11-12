import Link from "next/link";
import { linkClass, PageHeader } from "@/components/ui";
import { DrugForm } from "../../inventory-forms";

export default function NewDrugPage() {
  return (
    <>
      <PageHeader title="Add drug" subtitle="New item in the clinic's drug list" />
      <p className="mb-5 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
        Adding many?{" "}
        <Link href="/inventory/drugs/starter" className={linkClass}>
          Pick from the essential medicines list
        </Link>{" "}
        or{" "}
        <Link href="/inventory/drugs/import" className={linkClass}>
          import a spreadsheet
        </Link>
        .
      </p>
      <div className="max-w-2xl">
        <DrugForm />
      </div>
    </>
  );
}

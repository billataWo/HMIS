import { PageHeader } from "@/components/ui";
import { DrugForm } from "../../inventory-forms";

export default function NewDrugPage() {
  return (
    <>
      <PageHeader title="Add drug" subtitle="New item in the clinic's drug list" />
      <div className="max-w-2xl">
        <DrugForm />
      </div>
    </>
  );
}

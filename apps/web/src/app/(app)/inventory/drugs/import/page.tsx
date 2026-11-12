import { PageHeader } from "@/components/ui";
import { DrugImport } from "./drug-import";

export default function ImportDrugsPage() {
  return (
    <>
      <PageHeader title="Import drugs from a spreadsheet" subtitle="Add your whole drug list at once from Excel or Google Sheets" />
      <DrugImport />
    </>
  );
}

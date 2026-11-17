import { PageTitle } from "@/components/page-title";
import { DrugImport } from "./drug-import";

export default function ImportDrugsPage() {
  return (
    <>
      <PageTitle title="Import drugs from a spreadsheet" subtitle="Add your whole drug list at once from Excel or Google Sheets" />
      <DrugImport />
    </>
  );
}

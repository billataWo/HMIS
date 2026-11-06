import { PageHeader } from "@/components/ui";
import { WalkInForm } from "./walk-in-form";

export default function WalkInPage() {
  return (
    <>
      <PageHeader
        title="Walk-in sale"
        subtitle="ያለ ሐኪም ትዕዛዝ ሽያጭ · over the counter, for customers who did not see a doctor. It then follows the usual steps: cashier, then dispense."
      />
      <WalkInForm />
    </>
  );
}

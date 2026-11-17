import { PageTitle } from "@/components/page-title";
import { WalkInForm } from "./walk-in-form";

export default function WalkInPage() {
  return (
    <>
      <PageTitle title="Walk-in sale" subtitle="over the counter, for customers who did not see a doctor. It then follows the usual steps: cashier, then dispense." />
      <WalkInForm />
    </>
  );
}

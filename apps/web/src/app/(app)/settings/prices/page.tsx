import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type CatalogLabTest, type CatalogService } from "@/lib/api";
import { LabTestRow, ServiceRow } from "./price-forms";

async function Prices() {
  let services: CatalogService[], tests: CatalogLabTest[];
  try {
    [services, tests] = await Promise.all([api<CatalogService[]>("/catalog/services"), api<CatalogLabTest[]>("/catalog/lab-tests")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only clinic admins can change prices.</p>;
    throw e;
  }
  return (
    <div className="space-y-10">
      <section>
        <h2 className="font-medium">Services</h2>
        <p className="mb-2 text-sm text-slate-500">Consultation and other fees charged at check-in. Every price change is recorded in the audit log.</p>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {services.map((s) => (
            <ServiceRow key={s.id} s={s} />
          ))}
          <ServiceRow />
        </div>
      </section>
      <section>
        <h2 className="font-medium">Lab tests</h2>
        <p className="mb-2 text-sm text-slate-500">
          Numeric tests need a unit and reference range, so results are flagged high or low. Qualitative tests list their answer choices instead. Drug prices are set in{" "}
          <Link href="/inventory" className="text-brand-700 underline dark:text-brand-400">
            Inventory
          </Link>
          .
        </p>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {tests.map((t) => (
            <LabTestRow key={t.id} t={t} />
          ))}
          <LabTestRow />
        </div>
      </section>
    </div>
  );
}

export default function PricesPage() {
  return (
    <>
      <PageHeader
        title="Prices & tests"
        subtitle="ዋጋዎች"
        actions={
          <Link href="/settings" className={secondaryButtonClass}>
            Settings
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Prices />
      </Suspense>
    </>
  );
}

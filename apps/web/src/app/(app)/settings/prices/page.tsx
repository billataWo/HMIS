import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Skeleton } from "@/components/ui";
import { api, ApiError, type CatalogLabTest, type CatalogService } from "@/lib/api";
import { getT } from "@/lib/lang";
import { BackToSettings } from "../back-to-settings";
import { LabTestRow, ServiceRow } from "./price-forms";
import { RangesEditor, RecommendedRanges } from "./ranges-editor";
import { NoAccess } from "@/components/status-page";

async function Prices() {
  const t = await getT();
  let services: CatalogService[], tests: CatalogLabTest[];
  try {
    [services, tests] = await Promise.all([api<CatalogService[]>("/catalog/services"), api<CatalogLabTest[]>("/catalog/lab-tests")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only clinic admins can change prices.")}</NoAccess>;
    throw e;
  }
  return (
    <div className="space-y-10">
      <section>
        <h2 className="font-medium">{t("Services")}</h2>
        <p className="mb-2 text-sm text-slate-500">{t("Consultation and other fees charged at check-in. Every price change is recorded in the audit log.")}</p>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {services.map((s) => (
            <ServiceRow key={s.id} s={s} />
          ))}
          <ServiceRow />
        </div>
      </section>
      <section>
        <h2 className="font-medium">{t("Lab tests")}</h2>
        <p className="mb-2 text-sm text-slate-500">
          {t.rich(
            "Numeric tests need a unit and reference range, so results are flagged high or low. Qualitative tests list their answer choices instead. Drug prices are set in {inventory}.",
            {
              inventory: (
                <Link href="/inventory" className="text-brand-700 underline dark:text-brand-400">
                  {t("Inventory")}
                </Link>
              ),
            },
          )}
        </p>
        <RecommendedRanges />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {tests.map((x) => (
            <div key={x.id} className="pb-3">
              <LabTestRow test={x} />
              <RangesEditor test={x} />
            </div>
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
      <PageTitle title="Prices & tests" subtitle="fees, lab tests and their ranges" actions={<BackToSettings />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Prices />
      </Suspense>
    </>
  );
}

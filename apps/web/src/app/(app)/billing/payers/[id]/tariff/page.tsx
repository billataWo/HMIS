import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type PayerTariff } from "@/lib/api";
import { getT } from "@/lib/lang";
import { TariffEditor } from "./tariff-editor";

async function Tariff({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t] = await Promise.all([params, getT()]);
  let tariff: PayerTariff;
  try {
    tariff = await api<PayerTariff>(`/payers/${id}/tariff`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        title={t("{payer}: price list", { payer: tariff.payer.name })}
        subtitle={[
          t("What {payer} is charged. Empty: the clinic's price. Not covered: the patient pays it in full.", { payer: tariff.payer.name }),
          Number(tariff.payer.coPayPercent ?? 0) > 0 && t("On covered items the patient pays {n}%.", { n: Number(tariff.payer.coPayPercent) }),
        ]
          .filter(Boolean)
          .join(" ")}
        actions={
          <Link href={`/billing/payers/${tariff.payer.id}`} className={secondaryButtonClass}>
            <ArrowLeft aria-hidden />
            {t("Account")}
          </Link>
        }
      />
      <TariffEditor tariff={tariff} />
    </>
  );
}

export default function TariffPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Tariff params={params} />
    </Suspense>
  );
}

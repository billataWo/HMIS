import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type PayerTariff } from "@/lib/api";
import { TariffEditor } from "./tariff-editor";

async function Tariff({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let t: PayerTariff;
  try {
    t = await api<PayerTariff>(`/payers/${id}/tariff`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        title={`${t.payer.name}: price list`}
        subtitle={`What ${t.payer.name} is charged. Empty: the clinic's price. Not covered: the patient pays it in full.${Number(t.payer.coPayPercent ?? 0) > 0 ? ` On covered items the patient pays ${Number(t.payer.coPayPercent)}%.` : ""}`}
        actions={
          <Link href={`/billing/payers/${t.payer.id}`} className={secondaryButtonClass}>
            <ArrowLeft aria-hidden />
            Account
          </Link>
        }
      />
      <TariffEditor tariff={t} />
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

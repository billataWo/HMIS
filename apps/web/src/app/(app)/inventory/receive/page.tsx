import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type DrugOption, type DrugStock, type Supplier } from "@/lib/api";
import { clinicToday, shiftDay } from "@/lib/format";
import { ReceiveForm } from "./receive-form";

async function Receive({ searchParams }: { searchParams: Promise<{ drug?: string }> }) {
  const { drug } = await searchParams;
  let suppliers: Supplier[];
  try {
    suppliers = await api<Supplier[]>("/suppliers");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-zinc-500">Only pharmacists and admins receive stock.</p>;
    throw e;
  }
  let preset: DrugOption | undefined;
  if (drug) {
    const s = await api<DrugStock>(`/drugs/${drug}/stock`).catch(() => null);
    if (s) preset = { ...s.drug, inStock: s.batches.filter((b) => !b.expired).reduce((n, b) => n + b.quantity, 0) };
  }
  return <ReceiveForm suppliers={suppliers} preset={preset} minExpiry={shiftDay(clinicToday(), 1)} />;
}

export default function ReceivePage({ searchParams }: PageProps<"/inventory/receive">) {
  return (
    <>
      <PageHeader title="Receive stock" subtitle="Record a delivery: one line per batch" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Receive searchParams={searchParams as Promise<{ drug?: string }>} />
      </Suspense>
    </>
  );
}

import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type DrugOption, type DrugStock, type PurchaseOrder, type Store, type Supplier } from "@/lib/api";
import { clinicToday, shiftDay } from "@/lib/format";
import { ReceiveForm } from "./receive-form";

async function Receive({ searchParams }: { searchParams: Promise<{ drug?: string; po?: string }> }) {
  const { drug, po } = await searchParams;
  let suppliers: Supplier[];
  let stores: { multiStore: boolean; stores: Store[] };
  try {
    [suppliers, stores] = await Promise.all([api<Supplier[]>("/suppliers"), api<{ multiStore: boolean; stores: Store[] }>("/stores")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only pharmacists and admins receive stock.</p>;
    throw e;
  }
  let preset: DrugOption | undefined;
  if (drug) {
    const s = await api<DrugStock>(`/drugs/${drug}/stock`).catch(() => null);
    if (s) preset = { ...s.drug, inStock: s.batches.filter((b) => !b.expired).reduce((n, b) => n + b.quantity, 0) };
  }
  let order;
  if (po) {
    const o = await api<PurchaseOrder>(`/purchase-orders/${po}`).catch(() => null);
    if (o && (o.status === "ORDERED" || o.status === "PARTLY_RECEIVED")) {
      order = {
        id: o.id,
        number: o.number,
        supplierId: o.supplier.id,
        lines: o.lines
          .filter((l) => l.receivedQty < l.quantity)
          .map((l) => ({
            drug: { ...l.drug, brandName: null, drugClass: null, sellPrice: l.drug.sellPrice ?? "0", inStock: 0 },
            outstanding: l.quantity - l.receivedQty,
            unitCost: l.unitCost,
          })),
      };
    }
  }
  return (
    <ReceiveForm
      suppliers={suppliers}
      stores={stores.multiStore ? stores.stores.filter((s) => s.active) : []}
      preset={preset}
      order={order}
      minExpiry={shiftDay(clinicToday(), 1)}
    />
  );
}

export default function ReceivePage({ searchParams }: PageProps<"/inventory/receive">) {
  return (
    <>
      <PageHeader title="Receive stock" subtitle="Record a delivery: one line per batch" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Receive searchParams={searchParams as Promise<{ drug?: string; po?: string }>} />
      </Suspense>
    </>
  );
}

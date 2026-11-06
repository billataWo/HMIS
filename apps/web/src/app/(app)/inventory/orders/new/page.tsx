import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, type InventoryResponse, type Supplier } from "@/lib/api";
import { OrderForm } from "./order-form";

async function NewOrder() {
  const [suppliers, low] = await Promise.all([api<Supplier[]>("/suppliers"), api<InventoryResponse>("/inventory?filter=low")]);
  return <OrderForm suppliers={suppliers.filter((s) => s.active)} lowStock={low.drugs} />;
}

export default function NewOrderPage() {
  return (
    <>
      <PageHeader title="New purchase order" subtitle="Low-stock drugs are listed first; add others by search" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <NewOrder />
      </Suspense>
    </>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { inPlan, PlanNotice } from "@/components/plan-notice";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, type InventoryResponse, type Me, type Supplier } from "@/lib/api";
import { OrderForm } from "./order-form";

async function NewOrder() {
  const me = await api<Me>("/auth/me");
  if (!inPlan(me, "PURCHASE_ORDERS")) {
    return (
      <PlanNotice me={me} what="Purchase orders">
        You can still record deliveries in{" "}
        <Link href="/inventory/receive" className="font-medium underline">
          Receive stock
        </Link>
        .
      </PlanNotice>
    );
  }
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

import Link from "next/link";
import { Suspense } from "react";
import { PlanNotice } from "@/components/plan-notice";
import { inPlan } from "@/lib/plan";
import { PageTitle } from "@/components/page-title";
import { Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, type InventoryResponse, type Me, type Supplier } from "@/lib/api";
import { OrderForm } from "./order-form";

async function NewOrder() {
  const [me, t] = await Promise.all([api<Me>("/auth/me"), getT()]);
  if (!inPlan(me, "PURCHASE_ORDERS")) {
    return (
      <PlanNotice me={me} what="Purchase orders">
        {t.rich("You can still record deliveries in {link}.", {
          link: (
            <Link href="/inventory/receive" className="font-medium underline">
              {t("Receive stock")}
            </Link>
          ),
        })}
      </PlanNotice>
    );
  }
  const [suppliers, low] = await Promise.all([api<Supplier[]>("/suppliers"), api<InventoryResponse>("/inventory?filter=low")]);
  return <OrderForm suppliers={suppliers.filter((s) => s.active)} lowStock={low.drugs} />;
}

export default function NewOrderPage() {
  return (
    <>
      <PageTitle title="New purchase order" subtitle="Low-stock drugs are listed first; add others by search" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <NewOrder />
      </Suspense>
    </>
  );
}

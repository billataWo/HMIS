import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Badge, buttonClass, EmptyState, linkClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { PlanNotice } from "@/components/plan-notice";
import { inPlan } from "@/lib/plan";
import { api, ApiError, type Me, type PurchaseOrder } from "@/lib/api";
import { PO_STATUS } from "./po-status";
import { etb, formatDualDate } from "@/lib/format";
import { NoAccess } from "@/components/status-page";


async function Orders() {
  let orders: PurchaseOrder[], me: Me;
  const t = await getT();
  try {
    [orders, me] = await Promise.all([api<PurchaseOrder[]>("/purchase-orders"), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only pharmacists and admins manage purchase orders.")}</NoAccess>;
    throw e;
  }
  const notice = !inPlan(me, "PURCHASE_ORDERS") && (
    <PlanNotice me={me} what="Purchase orders">
      {t.rich("Record deliveries in {link} instead.", {
        link: (
          <Link href="/inventory/receive" className="font-medium underline">
            {t("Receive stock")}
          </Link>
        ),
      })}
    </PlanNotice>
  );
  if (!orders.length) {
    if (notice) return notice;
    return (
      <EmptyState icon={ClipboardList} title={t("No purchase orders yet")}>
        {t("Draft an order for a supplier, print it, and receive the delivery against it.")}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      {notice}
      <div className="surface overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
            <tr>
              <th className="px-4 py-3">{t("Order")}</th>
              <th className="px-4 py-3">{t("Supplier")}</th>
              <th className="px-4 py-3">{t("Date")}</th>
              <th className="px-4 py-3 text-right">{t("Lines")}</th>
              <th className="px-4 py-3 text-right">{t("Value")}</th>
              <th className="px-4 py-3">{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 font-mono text-xs">
                  <Link href={`/inventory/orders/${o.id}`} className={linkClass}>
                    {o.number}
                  </Link>
                </td>
                <td className="px-4 py-3">{o.supplier.name}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatDualDate(o.createdAt)}</td>
                <td className="px-4 py-3 text-right">{o.lines.length}</td>
                <td className="px-4 py-3 text-right tabular-nums">{etb(o.total, t)}</td>
                <td className="px-4 py-3">
                  <Badge tone={PO_STATUS[o.status].tone} dot>
                    {t(PO_STATUS[o.status].label)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function NewOrderLink() {
  const t = await getT();
  return (
    <Link href="/inventory/orders/new" className={buttonClass}>
      <Plus aria-hidden />
      {t("New order")}
    </Link>
  );
}

export default function OrdersPage() {
  return (
    <>
      <PageTitle title="Purchase orders" actions={<NewOrderLink />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Orders />
      </Suspense>
    </>
  );
}

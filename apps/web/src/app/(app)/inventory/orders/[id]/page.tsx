import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { purchaseOrderStep } from "@/app/actions";
import { Flash } from "@/components/flash";
import { PrintButton } from "@/components/print-button";
import { Badge, buttonClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type PurchaseOrder } from "@/lib/api";
import { etb, formatDualDate } from "@/lib/format";
import { PO_STATUS } from "../po-status";

async function Order({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  let po: PurchaseOrder;
  try {
    po = await api<PurchaseOrder>(`/purchase-orders/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const s = PO_STATUS[po.status];
  const receivable = po.status === "ORDERED" || po.status === "PARTLY_RECEIVED";

  return (
    <>
      <PageHeader
        title={`Purchase order ${po.number}`}
        subtitle={`${po.supplier.name} · ${formatDualDate(po.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Badge tone={s.tone} dot>
              {s.label}
            </Badge>
            {po.status === "DRAFT" && (
              <form action={purchaseOrderStep.bind(null, po.id, "order")}>
                <button className={buttonClass}>Mark as ordered</button>
              </form>
            )}
            {receivable && (
              <Link href={`/inventory/receive?po=${po.id}`} className={buttonClass}>
                Receive delivery
              </Link>
            )}
            <PrintButton inline />
            {po.status !== "RECEIVED" && po.status !== "CANCELLED" && (
              <form action={purchaseOrderStep.bind(null, po.id, "cancel")}>
                <button className={`${secondaryButtonClass} text-red-700`}>{po.status === "DRAFT" ? "Discard" : "Close order"}</button>
              </form>
            )}
          </div>
        }
      />
      <div className="print:hidden">
        <Flash params={flash} />
      </div>

      <div className="surface space-y-4 p-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase">From</p>
            <p className="font-medium">{po.tenant?.name}</p>
            <p className="text-slate-600 dark:text-slate-400">{[po.tenant?.address, po.tenant?.phone].filter(Boolean).join(" · ")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase">To</p>
            <p className="font-medium">{po.supplier.name}</p>
            <p className="text-slate-600 dark:text-slate-400">
              {[po.supplier.contactPerson, po.supplier.phone, po.supplier.tin && `TIN ${po.supplier.tin}`].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        {po.note && <p>Note: {po.note}</p>}
        <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] text-left">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2 pr-3">Drug</th>
              <th className="py-2 pr-3 text-right">Quantity</th>
              <th className="py-2 pr-3 text-right">Unit cost</th>
              <th className="py-2 pr-3 text-right">Amount</th>
              <th className="py-2 text-right print:hidden">Received</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-3">{[l.drug.genericName, l.drug.strength, l.drug.form].filter(Boolean).join(" ")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {l.quantity} {l.drug.unit}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.unitCost ? Number(l.unitCost).toFixed(2) : "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.unitCost ? etb(Number(l.unitCost) * l.quantity) : "—"}</td>
                <td className={`py-2 text-right tabular-nums print:hidden ${l.receivedQty >= l.quantity ? "text-emerald-700" : ""}`}>{l.receivedQty}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
              <td colSpan={3} className="py-2">
                Expected total
              </td>
              <td className="py-2 pr-3 text-right">{etb(po.total)}</td>
              <td className="print:hidden" />
            </tr>
          </tfoot>
        </table>
        </div>
        <p className="hidden pt-8 text-xs print:block">Ordered by: ____________________ Signature and stamp: ____________________</p>
      </div>
    </>
  );
}

export default function OrderPage({ params, searchParams }: PageProps<"/inventory/orders/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Order params={params} searchParams={searchParams as Promise<{ done?: string; error?: string }>} />
    </Suspense>
  );
}

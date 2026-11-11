import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type DrugStock } from "@/lib/api";
import { etb, formatDualDate, formatTime } from "@/lib/format";
import { AdjustForm, DrugForm } from "../../inventory-forms";

const MOVE_LABEL: Record<DrugStock["movements"][number]["type"], string> = {
  RECEIPT: "Received",
  DISPENSE: "Dispensed",
  ADJUSTMENT: "Adjusted",
  EXPIRED: "Expired write-off",
  TRANSFER_OUT: "Transferred out",
  TRANSFER_IN: "Transferred in",
};

async function Drug({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let s: DrugStock;
  try {
    s = await api<DrugStock>(`/drugs/${id}/stock`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only pharmacists and admins manage stock.</p>;
    throw e;
  }
  const d = s.drug;
  const onHand = s.batches.filter((b) => !b.expired).reduce((n, b) => n + b.quantity, 0);

  return (
    <>
      <PageHeader
        title={[d.genericName, d.strength, d.form].filter(Boolean).join(" ")}
        subtitle={`${onHand} ${d.unit} usable · ${Number(d.sellPrice).toFixed(2)} ETB per ${d.unit}${d.active ? "" : " · inactive"}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/inventory/receive?drug=${d.id}`} className={secondaryButtonClass}>
              Receive stock
            </Link>
            <Link href="/inventory" className={secondaryButtonClass}>
              Inventory
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-2 font-medium">Batches</h2>
            {s.batches.length === 0 ? (
              <p className="text-sm text-slate-500">No stock received yet.</p>
            ) : (
              <div className="overflow-x-auto surface">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
                    <tr>
                      <th className="px-4 py-3 font-medium">Batch</th>
                      <th className="px-4 py-3 font-medium">Expiry</th>
                      <th className="px-4 py-3 text-right font-medium">Qty</th>
                      <th className="px-4 py-3 text-right font-medium">Cost</th>
                      <th className="px-4 py-3 font-medium">Supplier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.batches.map((b) => (
                      <tr key={b.id} className={`border-t border-slate-200 dark:border-slate-800 ${b.quantity === 0 ? "text-slate-500" : ""}`}>
                        <td className="px-4 py-3 font-mono text-xs">{b.batchNo}</td>
                        <td className={`px-3 py-2 ${b.expired && b.quantity > 0 ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
                          {formatDualDate(b.expiryDate)}
                          {b.expired && " · expired"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{b.quantity}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{etb(b.costPrice)}</td>
                        <td className="px-4 py-3">
                          {b.supplierRef?.name ?? b.supplier ?? "—"}
                          {b.receiptRef && <span className="block text-xs text-slate-500">{b.receiptRef}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-medium">Stock history</h2>
            {s.movements.length === 0 ? (
              <p className="text-sm text-slate-500">No movements yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {s.movements.map((m) => (
                  <li key={m.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span>
                      <span className={`font-medium tabular-nums ${m.quantity < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </span>{" "}
                      {MOVE_LABEL[m.type]} · batch {m.batch.batchNo}
                      {m.reason && <span className="text-slate-500"> · {m.reason}</span>}
                      {m.type === "RECEIPT" && m.reference && <span className="text-slate-500"> · {m.reference}</span>}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDualDate(m.createdAt)} {formatTime(m.createdAt)}
                      {m.userName && ` · ${m.userName}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-8">
          <section className="surface p-4 dark:border-slate-800">
            <h2 className="mb-3 font-medium">Adjust stock</h2>
            <AdjustForm batches={s.batches} unit={d.unit} />
          </section>
          <section className="surface p-4 dark:border-slate-800">
            <h2 className="mb-3 font-medium">Details</h2>
            <DrugForm drug={d} />
          </section>
        </aside>
      </div>
    </>
  );
}

export default function DrugPage({ params }: PageProps<"/inventory/drugs/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Drug params={params} />
    </Suspense>
  );
}

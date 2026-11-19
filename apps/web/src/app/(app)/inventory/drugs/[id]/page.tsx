import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type DrugStock } from "@/lib/api";
import { etb, formatDualDate, formatTime } from "@/lib/format";
import { inPacks, packLabel } from "@/lib/packs";
import { AdjustForm, DrugForm } from "../../inventory-forms";
import { NoAccess } from "@/components/status-page";

const MOVE_LABEL: Record<DrugStock["movements"][number]["type"], string> = {
  RECEIPT: "Received",
  DISPENSE: "Dispensed",
  ADJUSTMENT: "Adjusted",
  EXPIRED: "Expired write-off",
  TRANSFER_OUT: "Transferred out",
  TRANSFER_IN: "Transferred in",
  RETURN: "Returned by patient",
};

async function Drug({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  let s: DrugStock;
  try {
    s = await api<DrugStock>(`/drugs/${id}/stock`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only pharmacists and admins manage stock.")}</NoAccess>;
    throw e;
  }
  const d = s.drug;
  const onHand = s.batches.filter((b) => !b.expired).reduce((n, b) => n + b.quantity, 0);

  return (
    <>
      <PageHeader
        title={[d.genericName, d.strength, d.form, d.controlled && `(${t(d.controlled === "NARCOTIC" ? "narcotic" : "psychotropic")})`].filter(Boolean).join(" ")}
        subtitle={[
          t("{n} {unit} usable", { n: onHand, unit: d.unit }) + (inPacks(onHand, d) ? ` (${inPacks(onHand, d)})` : ""),
          packLabel(d) && t("bought by the {pack}", { pack: packLabel(d) ?? "" }),
          t("{price} per {unit}", { price: etb(d.sellPrice, t), unit: d.unit }),
          !d.active && t("inactive"),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex gap-2">
            <Link href={`/inventory/receive?drug=${d.id}`} className={secondaryButtonClass}>
              {t("Receive stock")}
            </Link>
            <Link href="/inventory" className={secondaryButtonClass}>
              {t("Inventory")}
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-2 font-medium">{t("Batches")}</h2>
            {s.batches.length === 0 ? (
              <p className="text-sm text-slate-500">{t("No stock received yet.")}</p>
            ) : (
              <div className="overflow-x-auto surface">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t("Batch")}</th>
                      <th className="px-4 py-3 font-medium">{t("Expiry")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("Qty")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("Cost")}</th>
                      <th className="px-4 py-3 font-medium">{t("Supplier")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.batches.map((b) => (
                      <tr key={b.id} className={`border-t border-slate-200 dark:border-slate-800 ${b.quantity === 0 ? "text-slate-500" : ""}`}>
                        <td className="px-4 py-3 font-mono text-xs">
                          {b.batchNo}
                          {b.store && <span className="block font-sans text-slate-500">{b.store.name}</span>}
                        </td>
                        <td className={`px-3 py-2 ${b.expired && b.quantity > 0 ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
                          {formatDualDate(b.expiryDate)}
                          {b.expired && ` · ${t("expired")}`}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{b.quantity}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{etb(b.costPrice, t)}</td>
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
            <h2 className="mb-2 font-medium">{t("Stock history")}</h2>
            {s.movements.length === 0 ? (
              <p className="text-sm text-slate-500">{t("No movements yet.")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {s.movements.map((m) => (
                  <li key={m.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span>
                      <span className={`font-medium tabular-nums ${m.quantity < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </span>{" "}
                      {t(MOVE_LABEL[m.type])} · {t("batch {no}", { no: m.batch.batchNo })}
                      {m.reason && <span className="text-slate-500"> · {t(m.reason)}</span>}
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
            <h2 className="mb-3 font-medium">{t("Adjust stock")}</h2>
            <AdjustForm batches={s.batches} unit={d.unit} />
          </section>
          <section className="surface p-4 dark:border-slate-800">
            <h2 className="mb-3 font-medium">{t("Details")}</h2>
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

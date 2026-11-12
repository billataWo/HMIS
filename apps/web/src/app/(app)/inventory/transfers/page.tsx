import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, linkClass, Notice, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type InventoryResponse, type Me, type StockTransfer, type Store } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";
import { StoresPanel } from "./stores-panel";
import { TransferForm } from "./transfer-form";

/** What the page shows; null when this person may not manage stock. */
async function load() {
  try {
    const [me, stores] = await Promise.all([api<Me>("/auth/me"), api<{ multiStore: boolean; stores: Store[] }>("/stores")]);
    if (!stores.multiStore) return { me, stores, inventory: null, transfers: [] as StockTransfer[] };
    const [inventory, transfers] = await Promise.all([api<InventoryResponse>("/inventory"), api<StockTransfer[]>("/inventory/transfers")]);
    return { me, stores, inventory, transfers };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

async function Transfers() {
  const data = await load();
  if (!data) return <p className="text-sm text-slate-500">Only pharmacists and admins move stock between stores.</p>;
  const { me, stores, inventory, transfers } = data;
  if (!inventory) {
    return (
      <EmptyState icon={ArrowRightLeft} title="Your clinic keeps one stock">
        To keep a main store and a dispensary and move stock between them, turn on &ldquo;Several stores&rdquo; in{" "}
        {me.role === "ADMIN" ? (
          <Link href="/settings" className={linkClass}>
            Settings
          </Link>
        ) : (
          "Settings (ask the clinic's admin)"
        )}
        .
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">Move stock</h2>
        <TransferForm stores={stores.stores} drugs={inventory.drugs} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">Recent transfers</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-slate-500">No transfers yet.</p>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-xs text-slate-500 dark:bg-slate-800/40">
                <tr>
                  <th className="px-4 py-2 font-medium">Transfer</th>
                  <th className="px-4 py-2 font-medium">From → to</th>
                  <th className="px-4 py-2 font-medium">Drugs moved</th>
                  <th className="px-4 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="font-mono text-xs">{t.number}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDualDate(t.createdAt)} · {formatTime(t.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {t.from} → {t.to}
                      {t.note && <span className="block text-xs text-slate-500">{t.note}</span>}
                    </td>
                    <td className="px-4 py-2">
                      <ul className="space-y-0.5">
                        {t.lines.map((l, i) => (
                          <li key={i}>
                            {[l.drug.genericName, l.drug.strength, l.drug.form].filter(Boolean).join(" ")} × {l.quantity}
                            <span className="text-xs text-slate-500"> · batch {l.batchNo}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">{t.by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">Stores</h2>
        <Notice tone="info">
          Deliveries go into the first store that doesn&apos;t dispense (or the one chosen when receiving). The pharmacy dispenses only from stores marked
          &ldquo;Dispenses&rdquo;.
        </Notice>
        <StoresPanel stores={stores.stores} />
      </section>
    </div>
  );
}

export default function TransfersPage() {
  return (
    <>
      <PageHeader title="Transfers between stores" subtitle="ክምችት ማዘዋወር · main store, dispensary and other stores" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Transfers />
      </Suspense>
    </>
  );
}

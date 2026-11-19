import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { EmptyState, linkClass, Notice, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type InventoryResponse, type Me, type StockTransfer, type Store } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";
import { StoresPanel } from "./stores-panel";
import { TransferForm } from "./transfer-form";
import { NoAccess } from "@/components/status-page";

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
  const [data, t] = await Promise.all([load(), getT()]);
  if (!data) return <NoAccess>{t("Only pharmacists and admins move stock between stores.")}</NoAccess>;
  const { me, stores, inventory, transfers } = data;
  if (!inventory) {
    return (
      <EmptyState icon={ArrowRightLeft} title={t("Your clinic keeps one stock")}>
        {t.rich("To keep a main store and a dispensary and move stock between them, turn on “Several stores” in {settings}.", {
          settings:
            me.role === "ADMIN" ? (
              <Link href="/settings" className={linkClass}>
                {t("Settings")}
              </Link>
            ) : (
              t("Settings (ask the clinic's admin)")
            ),
        })}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">{t("Move stock")}</h2>
        <TransferForm stores={stores.stores} drugs={inventory.drugs} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">{t("Recent transfers")}</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-slate-500">{t("No transfers yet.")}</p>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-xs text-slate-500 dark:bg-slate-800/40">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("Transfer")}</th>
                  <th className="px-4 py-2 font-medium">{t("From → to")}</th>
                  <th className="px-4 py-2 font-medium">{t("Drugs moved")}</th>
                  <th className="px-4 py-2 font-medium">{t("By")}</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((tr) => (
                  <tr key={tr.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="font-mono text-xs">{tr.number}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDualDate(tr.createdAt)} · {formatTime(tr.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {tr.from} → {tr.to}
                      {tr.note && <span className="block text-xs text-slate-500">{tr.note}</span>}
                    </td>
                    <td className="px-4 py-2">
                      <ul className="space-y-0.5">
                        {tr.lines.map((l, i) => (
                          <li key={i}>
                            {[l.drug.genericName, l.drug.strength, l.drug.form].filter(Boolean).join(" ")} × {l.quantity}
                            <span className="text-xs text-slate-500"> · {t("batch {no}", { no: l.batchNo })}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">{tr.by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">{t("Stores")}</h2>
        <Notice tone="info">
          {t("Deliveries go into the first store that doesn't dispense (or the one chosen when receiving). The pharmacy dispenses only from stores marked “Dispenses”.")}
        </Notice>
        <StoresPanel stores={stores.stores} />
      </section>
    </div>
  );
}

export default function TransfersPage() {
  return (
    <>
      <PageTitle title="Transfers between stores" subtitle="main store, dispensary and other stores" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Transfers />
      </Suspense>
    </>
  );
}

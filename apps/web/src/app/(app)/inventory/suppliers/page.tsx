import { Suspense } from "react";
import { setSupplierActive } from "@/app/actions";
import { PageTitle } from "@/components/page-title";
import { Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type Supplier } from "@/lib/api";
import { SupplierForm } from "../inventory-forms";
import { NoAccess } from "@/components/status-page";

async function Suppliers() {
  let suppliers: Supplier[];
  const t = await getT();
  try {
    suppliers = await api<Supplier[]>("/suppliers");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only pharmacists and admins manage suppliers.")}</NoAccess>;
    throw e;
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      {suppliers.length === 0 ? (
        <p className="text-sm text-slate-500">{t("No suppliers yet.")}</p>
      ) : (
        <div className="overflow-x-auto surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-3 font-medium">{t("Supplier")}</th>
                <th className="px-4 py-3 font-medium">{t("Phone")}</th>
                <th className="px-4 py-3 font-medium">TIN</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className={`border-t border-slate-200 dark:border-slate-800 ${s.active ? "" : "text-slate-500"}`}>
                  <td className="px-4 py-3">
                    {s.name}
                    {s.contactPerson && <span className="block text-xs text-slate-500">{s.contactPerson}</span>}
                  </td>
                  <td className="px-4 py-3">{s.phone ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.tin ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <form action={setSupplierActive.bind(null, s.id, !s.active)}>
                      <button className="text-xs text-brand-700 hover:underline dark:text-brand-400">{t(s.active ? "Deactivate" : "Reactivate")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section>
        <h2 className="mb-3 font-medium">{t("Add supplier")}</h2>
        <SupplierForm />
      </section>
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <>
      <PageTitle title="Suppliers" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Suppliers />
      </Suspense>
    </>
  );
}

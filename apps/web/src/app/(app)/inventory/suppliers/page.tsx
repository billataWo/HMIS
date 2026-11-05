import { Suspense } from "react";
import { setSupplierActive } from "@/app/actions";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError, type Supplier } from "@/lib/api";
import { SupplierForm } from "../inventory-forms";

async function Suppliers() {
  let suppliers: Supplier[];
  try {
    suppliers = await api<Supplier[]>("/suppliers");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-zinc-500">Only pharmacists and admins manage suppliers.</p>;
    throw e;
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      {suppliers.length === 0 ? (
        <p className="text-sm text-zinc-500">No suppliers yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">TIN</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className={`border-t border-zinc-200 dark:border-zinc-800 ${s.active ? "" : "text-zinc-400"}`}>
                  <td className="px-3 py-2">
                    {s.name}
                    {s.contactPerson && <span className="block text-xs text-zinc-500">{s.contactPerson}</span>}
                  </td>
                  <td className="px-3 py-2">{s.phone ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.tin ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={setSupplierActive.bind(null, s.id, !s.active)}>
                      <button className="text-xs text-teal-700 hover:underline dark:text-teal-400">{s.active ? "Deactivate" : "Reactivate"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section>
        <h2 className="mb-3 font-medium">Add supplier</h2>
        <SupplierForm />
      </section>
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <>
      <PageHeader title="Suppliers" subtitle="አቅራቢዎች" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Suppliers />
      </Suspense>
    </>
  );
}

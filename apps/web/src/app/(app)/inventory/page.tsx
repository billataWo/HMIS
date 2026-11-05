import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { writeOffExpired } from "@/app/actions";
import { Flash } from "@/components/flash";
import { buttonClass, inputClass, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type InventoryResponse } from "@/lib/api";
import { etb, formatDualDate } from "@/lib/format";

type Search = { q?: string; filter?: string; done?: string; error?: string };

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["low", "Low stock"],
  ["expiring", "Expiring soon"],
  ["expired", "Expired"],
  ["inactive", "Inactive"],
];

function Tile({ label, value, href, tone }: { label: string; value: string; href?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-700 dark:text-red-400" : tone === "warn" ? "text-amber-700 dark:text-amber-400" : "";
  const body = (
    <>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
    </>
  );
  const cls = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
  return href ? (
    <Link href={href} className={`${cls} hover:border-teal-600`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

async function Inventory({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const filter = FILTERS.some(([k]) => k === params.filter) ? params.filter! : "all";
  const q = params.q?.trim() ?? "";
  let data: InventoryResponse;
  try {
    data = await api<InventoryResponse>(`/inventory?filter=${filter}&q=${encodeURIComponent(q)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-zinc-500">Only pharmacists and admins manage stock.</p>;
    throw e;
  }
  const s = data.summary;

  return (
    <>
      <Flash params={params} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Stock value (cost) · ${s.drugs} drugs`} value={etb(s.stockValue)} />
        <Tile label="Low stock" value={String(s.low)} href="/inventory?filter=low" tone={s.low ? "warn" : undefined} />
        <Tile label={`Expiring within ${s.expiryWarningDays} days`} value={String(s.expiring)} href="/inventory?filter=expiring" tone={s.expiring ? "warn" : undefined} />
        <Tile label={`Expired on shelf · ${etb(s.expiredValue)}`} value={String(s.expired)} href="/inventory?filter=expired" tone={s.expired ? "bad" : undefined} />
      </div>

      {s.expired > 0 && (
        <form action={writeOffExpired} className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          Expired stock can&apos;t be dispensed. Remove it from the shelf, then record the write-off.
          <button className={`${secondaryButtonClass} px-3 py-1 text-xs`}>Write off all expired stock</button>
        </form>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <Link
            key={k}
            href={`/inventory?filter=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full px-3 py-1 text-sm ${filter === k ? "bg-teal-700 text-white" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {label}
          </Link>
        ))}
        <Form action="/inventory" className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input name="q" defaultValue={q} placeholder="Search drugs" className={`${inputClass} w-48`} />
        </Form>
      </div>

      {data.drugs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">Nothing here.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Drug</th>
                <th className="px-3 py-2 text-right font-medium">On hand</th>
                <th className="px-3 py-2 text-right font-medium">Reorder at</th>
                <th className="px-3 py-2 font-medium">Nearest expiry</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.drugs.map((d) => (
                <tr key={d.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <Link href={`/inventory/drugs/${d.id}`} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                      {d.genericName}
                    </Link>{" "}
                    {d.strength} {d.form}
                    {d.drugClass && <span className="block text-xs text-zinc-500">{d.drugClass}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${d.low ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>
                    {d.onHand} <span className="text-xs text-zinc-500">{d.unit}</span>
                    {d.expiredQty > 0 && <span className="block text-xs font-medium text-red-700 dark:text-red-400">+{d.expiredQty} expired</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{d.reorderLevel || "—"}</td>
                  <td className="px-3 py-2">
                    {d.nearestExpiry ? formatDualDate(d.nearestExpiry) : "—"}
                    {d.expiringSoon > 0 && <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">{d.expiringSoon} expiring soon</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(d.sellPrice).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{etb(d.stockValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="መድኃኒት ክምችት · stock, expiry and value"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/inventory/receive" className={buttonClass}>
              Receive stock
            </Link>
            <Link href="/inventory/drugs/new" className={secondaryButtonClass}>
              Add drug
            </Link>
            <Link href="/inventory/suppliers" className={secondaryButtonClass}>
              Suppliers
            </Link>
          </div>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Inventory searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

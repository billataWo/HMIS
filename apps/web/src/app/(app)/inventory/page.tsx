import { Package } from "lucide-react";
import { ControlledBadge } from "@/components/controlled-badge";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { writeOffExpired } from "@/app/actions";
import { Flash } from "@/components/flash";
import { PageTitle } from "@/components/page-title";
import { EmptyState, buttonClass, inputClass, secondaryButtonClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type InventoryResponse } from "@/lib/api";
import { etb, formatDualDate } from "@/lib/format";
import { inPacks } from "@/lib/packs";
import { NoAccess } from "@/components/status-page";

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
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
    </>
  );
  const cls = "surface p-4 dark:border-slate-800";
  return href ? (
    <Link href={href} className={`${cls} hover:border-brand-600`}>
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
  const t = await getT();
  let data: InventoryResponse;
  try {
    data = await api<InventoryResponse>(`/inventory?filter=${filter}&q=${encodeURIComponent(q)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess>{t("Only pharmacists and admins manage stock.")}</NoAccess>;
    throw e;
  }
  const s = data.summary;

  return (
    <>
      <Flash params={params} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("Stock value (cost) · {n} drugs", { n: s.drugs })} value={etb(s.stockValue, t)} />
        <Tile label={t("Low stock")} value={String(s.low)} href="/inventory?filter=low" tone={s.low ? "warn" : undefined} />
        <Tile label={t("Expiring within {n} days", { n: s.expiryWarningDays })} value={String(s.expiring)} href="/inventory?filter=expiring" tone={s.expiring ? "warn" : undefined} />
        <Tile label={t("Expired on shelf · {amount}", { amount: etb(s.expiredValue, t) })} value={String(s.expired)} href="/inventory?filter=expired" tone={s.expired ? "bad" : undefined} />
      </div>

      {s.expired > 0 && (
        <form action={writeOffExpired} className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {t("Expired stock can't be dispensed. Remove it from the shelf, then record the write-off.")}
          <button className={`${secondaryButtonClass} px-3 py-1 text-xs`}>{t("Write off all expired stock")}</button>
        </form>
      )}

      {data.summary.multiStore && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          {t("Stock is kept in several stores; the pharmacy dispenses from the dispensary.")}
          <Link href="/inventory/transfers" className={secondaryButtonClass}>
            {t("Transfers between stores")}
          </Link>
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <Link
            key={k}
            href={`/inventory?filter=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full px-3 py-1 text-sm ${filter === k ? "bg-brand-700 text-white" : "border border-slate-300 dark:border-slate-700"}`}
          >
            {t(label)}
          </Link>
        ))}
        <Form action="/inventory" className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input name="q" defaultValue={q} placeholder={t("Search drugs")} aria-label={t("Search drugs")} className={`${inputClass} w-48`} />
        </Form>
      </div>

      {data.drugs.length === 0 ? (
        data.summary.drugs === 0 && !q && filter === "all" ? (
          // A new clinic: start the drug list without typing it all in.
          <EmptyState
            icon={Package}
            title={t("Your drug list is empty")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/inventory/drugs/starter" className={buttonClass}>
                  {t("Pick from the essential medicines list")}
                </Link>
                <Link href="/inventory/drugs/import" className={secondaryButtonClass}>
                  {t("Import a spreadsheet")}
                </Link>
              </div>
            }
          >
            {t("Pick the medicines you stock from a ready list, import your own list from Excel, or add drugs one by one.")}
          </EmptyState>
        ) : (
          <EmptyState icon={Package} title={t("No drugs match this view")} />
        )
      ) : (
        <div className="overflow-x-auto surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
              <tr>
                <th className="px-4 py-3 font-medium">{t("Drug")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("On hand")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("Reorder at")}</th>
                <th className="px-4 py-3 font-medium">{t("Nearest expiry")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("Price")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("Value")}</th>
              </tr>
            </thead>
            <tbody>
              {data.drugs.map((d) => (
                <tr key={d.id} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="px-4 py-3">
                    <Link href={`/inventory/drugs/${d.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                      {d.genericName}
                    </Link>{" "}
                    {d.strength} {d.form} <ControlledBadge c={d.controlled} />
                    {d.drugClass && <span className="block text-xs text-slate-500">{d.drugClass}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${d.low ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>
                    {d.onHand} <span className="text-xs text-slate-500">{d.unit}</span>
                    {inPacks(d.onHand, d) && <span className="block text-xs text-slate-500">{inPacks(d.onHand, d)}</span>}
                    {d.byStore && d.byStore.length > 0 && (
                      <span className="block text-xs whitespace-nowrap text-slate-500">{d.byStore.map((b) => `${b.name} ${b.quantity}`).join(" · ")}</span>
                    )}
                    {d.expiredQty > 0 && <span className="block text-xs font-medium text-red-700 dark:text-red-400">{t("+{n} expired", { n: d.expiredQty })}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{d.reorderLevel || "—"}</td>
                  <td className="px-4 py-3">
                    {d.nearestExpiry ? formatDualDate(d.nearestExpiry) : "—"}
                    {d.expiringSoon > 0 && <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">{t("{n} expiring soon", { n: d.expiringSoon })}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(d.sellPrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{etb(d.stockValue, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Actions() {
  const t = await getT();
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/inventory/receive" className={buttonClass}>
        {t("Receive stock")}
      </Link>
      <Link href="/inventory/drugs/new" className={secondaryButtonClass}>
        {t("Add drug")}
      </Link>
      <Link href="/inventory/orders" className={secondaryButtonClass}>
        {t("Purchase orders")}
      </Link>
      <Link href="/inventory/count" className={secondaryButtonClass}>
        {t("Stock count")}
      </Link>
      <Link href="/inventory/controlled" className={secondaryButtonClass}>
        {t("Controlled register")}
      </Link>
      <Link href="/inventory/suppliers" className={secondaryButtonClass}>
        {t("Suppliers")}
      </Link>
    </div>
  );
}

export default function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  return (
    <>
      <PageTitle title="Inventory" subtitle="stock, expiry and value" actions={<Actions />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Inventory searchParams={searchParams as Promise<Search>} />
      </Suspense>
    </>
  );
}

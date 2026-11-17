import { ArrowLeft, TestTubes } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { Badge, EmptyState, secondaryButtonClass, Skeleton } from "@/components/ui";
import { getT } from "@/lib/lang";
import { api, ApiError, type LabReagentMovement, type LabReagentsPage } from "@/lib/api";
import { countOf, formatTime, isPast } from "@/lib/format";
import { Adjust, AddReagent, Receive, Settings, Uses } from "./reagent-forms";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Addis_Ababa" });
const MOVE: Record<LabReagentMovement["type"], string> = { RECEIVE: "Received", USE: "Patient test", QC: "QC run", ADJUST: "Adjusted", EXPIRED: "Expired" };

/** The last changes to one reagent's stock (opened from its "History" link). */
async function History({ id, name }: { id: string; name: string }) {
  const [moves, t] = await Promise.all([api<LabReagentMovement[]>(`/lab/reagents/${id}/movements`), getT()]);
  return (
    <section className="surface space-y-2 p-4 dark:border-slate-800">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t("History: {name}", { name })}</h2>
        <Link href="/lab/reagents" className="text-xs text-brand-700 hover:underline dark:text-brand-400">
          {t("Close")}
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-medium">{t("When")}</th>
              <th className="py-1 pr-2 font-medium">{t("What")}</th>
              <th className="py-1 pr-2 font-medium">{t("Lot")}</th>
              <th className="py-1 pr-2 text-right font-medium">{t("Change")}</th>
              <th className="py-1 font-medium">{t("Why")}</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2 whitespace-nowrap">
                  {day(m.createdAt)} {formatTime(m.createdAt)}
                </td>
                <td className="py-1 pr-2">{t(MOVE[m.type])}</td>
                <td className="py-1 pr-2">{m.lotRow ? (m.lotRow.lot ?? "—") : <span className="text-amber-700 dark:text-amber-400">{t("none on record")}</span>}</td>
                <td className={`py-1 pr-2 text-right tabular-nums ${m.quantity < 0 ? "" : "text-emerald-700 dark:text-emerald-400"}`}>
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </td>
                <td className="py-1 text-slate-500">{m.reason && t(m.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function Reagents({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  const { history } = await searchParams;
  const t = await getT();
  let data: LabReagentsPage;
  try {
    data = await api<LabReagentsPage>("/lab/reagents");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">{t("Only lab technicians and admins keep reagent stock.")}</p>;
    throw e;
  }
  const shown = data.reagents.find((r) => r.id === history);
  return (
    <div className="space-y-6">
      {shown && <History id={shown.id} name={shown.name} />}
      {data.reagents.length === 0 ? (
        <EmptyState icon={TestTubes} title={t("No reagents yet")}>
          {t("Add the kits, strips and reagent packs your tests use; each patient test and QC run then takes from their stock.")}
        </EmptyState>
      ) : (
        data.reagents.map((r) => (
          <section key={r.id} id={`reagent-${r.id}`} className={`surface scroll-mt-6 space-y-3 p-4 dark:border-slate-800 ${r.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-semibold">{r.name}</span>
                <span className="text-sm text-slate-500">
                  {" "}
                  · {t("{count} on hand", { count: countOf(r.onHand, r.unit) })}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs">
                {r.low && <Badge tone={r.onHand === 0 ? "danger" : "warning"}>{t(r.onHand === 0 ? "Out of stock" : "Low: reorder")}</Badge>}
                {r.expiringSoon > 0 && <Badge tone="warning">{t("{n} expiring within 60 days", { n: r.expiringSoon })}</Badge>}
                {r.expired > 0 && <Badge tone="danger">{t("{n} expired on the shelf", { n: r.expired })}</Badge>}
                <Link href={`/lab/reagents?history=${r.id}`} className="text-brand-700 hover:underline dark:text-brand-400">
                  {t("History")}
                </Link>
              </span>
            </div>
            {r.usedWithoutStock > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
                {t("{count} used with none on record. Count what is on the shelf and adjust (reason “Counted”) to put it right.", { count: countOf(r.usedWithoutStock, r.unit) })}
              </p>
            )}
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Used by:")}{" "}
              {r.uses.length ? r.uses.map((u) => `${u.labTest.name}${u.perTest > 1 ? ` (${u.perTest} ${r.unit})` : ""}`).join(", ") : <span className="text-slate-500">{t("no tests yet")}</span>}
            </p>
            {r.lots.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
                {r.lots.map((l) => {
                  const expired = !!l.expiresAt && isPast(l.expiresAt);
                  return (
                    <li key={l.id} className="px-3 py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          {l.lot ? t("Lot {lot}", { lot: l.lot }) : t("No lot number")}
                          <span className="text-slate-500">
                            {" "}
                            · {countOf(l.quantity, r.unit)}
                            {l.expiresAt && ` · ${t("expires {date}", { date: day(l.expiresAt) })}`}
                            {expired && <span className="font-medium text-red-700 dark:text-red-400"> ({t("expired: count it out")})</span>}
                          </span>
                        </span>
                        <Adjust r={r} lot={l} reasons={data.adjustReasons} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Receive r={r} />
            <details>
              <summary className="cursor-pointer text-xs text-brand-700 dark:text-brand-400">{t("Tests that use it, reorder level")}</summary>
              <div className="mt-2 space-y-3">
                <Uses r={r} tests={data.tests} />
                <Settings r={r} />
              </div>
            </details>
          </section>
        ))
      )}
      <section className="surface space-y-3 p-4 dark:border-slate-800">
        <h2 className="font-semibold">{t("Add a reagent")}</h2>
        <AddReagent />
      </section>
    </div>
  );
}

async function BackToBench() {
  const t = await getT();
  return (
    <Link href="/lab" className={secondaryButtonClass}>
      <ArrowLeft aria-hidden />
      {t("Lab bench")}
    </Link>
  );
}

export default function ReagentsPage({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  return (
    <>
      <PageTitle title="Reagents" subtitle="lab stock by lot and expiry" actions={<BackToBench />} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Reagents searchParams={searchParams} />
      </Suspense>
    </>
  );
}

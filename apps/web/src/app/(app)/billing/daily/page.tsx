import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type DailySummary, type Me } from "@/lib/api";
import { clinicToday, etb, formatDualDate, formatTime, PAYMENT_METHODS, shiftDay } from "@/lib/format";
import { CloseCashForm } from "../billing-forms";

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</p>
    </div>
  );
}

async function Daily({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const params = await searchParams;
  const today = clinicToday();
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today;
  let s: DailySummary, me: Me;
  try {
    [s, me] = await Promise.all([api<DailySummary>(`/billing/daily?day=${day}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-zinc-500">Only cashiers and admins can see takings.</p>;
    throw e;
  }
  const myClosing = s.closings.find((c) => c.cashier.id === me.id);
  const myCash = s.cashiers.find((c) => c.cashier.id === me.id)?.byMethod.CASH ?? "0";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/billing/daily?day=${shiftDay(day, -1)}`} className={secondaryButtonClass}>
          ←
        </Link>
        <span className="px-2 font-medium">
          {formatDualDate(`${day}T12:00:00+03:00`)}
          {day === today && <span className="text-zinc-500"> · today</span>}
        </span>
        {day !== today && (
          <>
            <Link href={`/billing/daily?day=${shiftDay(day, 1)}`} className={secondaryButtonClass}>
              →
            </Link>
            <Link href="/billing/daily" className={secondaryButtonClass}>
              Today
            </Link>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Collected" value={etb(s.collected)} />
        <Tile label={`Billed (${s.invoices.count} invoices)`} value={etb(s.invoices.billed)} />
        <Tile label="Still unpaid" value={etb(s.invoices.unpaid)} tone={Number(s.invoices.unpaid) > 0 ? "warn" : undefined} />
        <Tile label={`Discounts${s.invoices.voided ? ` · ${s.invoices.voided} voided` : ""}`} value={etb(s.invoices.discounts)} />
      </div>

      <section>
        <h2 className="mb-2 font-medium">By cashier</h2>
        {s.cashiers.length === 0 ? (
          <p className="text-sm text-zinc-500">No payments taken.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Cashier</th>
                  {Object.entries(PAYMENT_METHODS).map(([k, l]) => (
                    <th key={k} className="px-3 py-2 text-right font-medium">{l}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody>
                {s.cashiers.map((c) => {
                  const closing = s.closings.find((x) => x.cashier.id === c.cashier.id);
                  return (
                    <tr key={c.cashier.id} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-3 py-2">{c.cashier.fullName}</td>
                      {Object.keys(PAYMENT_METHODS).map((k) => (
                        <td key={k} className="px-3 py-2 text-right tabular-nums">
                          {c.byMethod[k as keyof typeof c.byMethod] ? etb(c.byMethod[k as keyof typeof c.byMethod]!) : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{etb(c.total)}</td>
                      <td className="px-3 py-2">
                        {closing ? (
                          <span className={Number(closing.variance) === 0 ? "" : "font-medium text-red-700 dark:text-red-400"}>
                            {Number(closing.variance) === 0 ? "Balanced" : `${Number(closing.variance) > 0 ? "Over" : "Short"} ${etb(Math.abs(Number(closing.variance)))}`}
                            {closing.note && <span className="block text-xs text-zinc-500">{closing.note}</span>}
                          </span>
                        ) : (
                          <span className="text-zinc-500">Not yet</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {day === today && (
        <section className="max-w-xl rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 font-medium">Close my cash</h2>
          {myClosing ? (
            <p className="text-sm">
              Closed at {formatTime(myClosing.createdAt)}: expected {etb(myClosing.expectedCash)}, counted {etb(myClosing.countedCash)}
              {Number(myClosing.variance) !== 0 && (
                <strong className="text-red-700 dark:text-red-400"> ({Number(myClosing.variance) > 0 ? "over" : "short"} {etb(Math.abs(Number(myClosing.variance)))})</strong>
              )}
              . You can&apos;t take more payments today.
            </p>
          ) : (
            <CloseCashForm expectedCash={myCash} />
          )}
        </section>
      )}
    </div>
  );
}

export default function DailyPage({ searchParams }: PageProps<"/billing/daily">) {
  return (
    <>
      <PageHeader title="Day summary" subtitle="የዕለቱ ገቢ · takings and cash closing" />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Daily searchParams={searchParams as Promise<{ day?: string }>} />
      </Suspense>
    </>
  );
}

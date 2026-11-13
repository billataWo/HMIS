import { connection } from "next/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { api, ApiError, type CashShift, type DailySummary, type Me } from "@/lib/api";
import { clinicToday, etb, formatDualDate, formatTime, PAYMENT_METHODS, shiftDay } from "@/lib/format";
import { CloseCashForm } from "../billing-forms";

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="surface p-4 dark:border-slate-800">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</p>
    </div>
  );
}

async function Daily({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const params = await searchParams;
  await connection(); // "today" is the request's, not a prerender's
  const today = clinicToday();
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today;
  let s: DailySummary, me: Me;
  try {
    [s, me] = await Promise.all([api<DailySummary>(`/billing/daily?day=${day}`), api<Me>("/auth/me")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <p className="text-sm text-slate-500">Only cashiers and admins can see takings.</p>;
    throw e;
  }
  const mine = s.closings.filter((c) => c.cashier.id === me.id);
  // The cashier's open shift (today only).
  const shift = day === today ? await api<CashShift>("/billing/shift") : null;
  const verdict = (v: string) => (Number(v) === 0 ? "Balanced" : `${Number(v) > 0 ? "Over" : "Short"} ${etb(Math.abs(Number(v)))}`);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/billing/daily?day=${shiftDay(day, -1)}`} aria-label="Previous day" className={`${secondaryButtonClass} px-2.5`}>
          <ChevronLeft aria-hidden />
        </Link>
        <span className="px-2 font-medium">
          {formatDualDate(`${day}T12:00:00+03:00`)}
          {day === today && <span className="text-slate-500"> · today</span>}
        </span>
        {day !== today && (
          <>
            <Link href={`/billing/daily?day=${shiftDay(day, 1)}`} aria-label="Next day" className={`${secondaryButtonClass} px-2.5`}>
              <ChevronRight aria-hidden />
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
          <p className="text-sm text-slate-500">No payments taken.</p>
        ) : (
          <div className="overflow-x-auto surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-800/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Cashier</th>
                  {Object.entries(PAYMENT_METHODS).map(([k, l]) => (
                    <th key={k} className="px-3 py-2 text-right font-medium">{l}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody>
                {s.cashiers.map((c) => {
                  const shifts = s.closings.filter((x) => x.cashier.id === c.cashier.id);
                  return (
                    <tr key={c.cashier.id} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="px-4 py-3">{c.cashier.fullName}</td>
                      {Object.keys(PAYMENT_METHODS).map((k) => (
                        <td key={k} className="px-3 py-2 text-right tabular-nums">
                          {c.byMethod[k as keyof typeof c.byMethod] ? etb(c.byMethod[k as keyof typeof c.byMethod]!) : "—"}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{etb(c.total)}</td>
                      <td className="px-4 py-3">
                        {shifts.length ? (
                          shifts.map((x) => (
                            <span key={x.id} className={`block ${Number(x.variance) === 0 ? "" : "font-medium text-red-700 dark:text-red-400"}`}>
                              {formatTime(x.createdAt)}: {verdict(x.variance)}
                              {(x.handedTo || x.note) && <span className="block text-xs font-normal text-slate-500">{[x.handedTo && `to ${x.handedTo}`, x.note].filter(Boolean).join(" · ")}</span>}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500">Not yet</span>
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

      {shift && (
        <section className="max-w-2xl space-y-3 surface p-4 dark:border-slate-800">
          <h2 className="font-medium">Close my shift</h2>
          {mine.length > 0 && (
            <ul className="space-y-1 text-sm">
              {mine.map((c) => (
                <li key={c.id}>
                  Shift closed at {formatTime(c.createdAt)}: expected {etb(c.expectedCash)}, counted {etb(c.countedCash)}
                  <span className={Number(c.variance) === 0 ? "text-slate-500" : "font-medium text-red-700 dark:text-red-400"}>
                    {" "}
                    · {Number(c.variance) === 0 ? "balanced" : `${Number(c.variance) > 0 ? "over" : "short"} ${etb(Math.abs(Number(c.variance)))}`}
                  </span>
                  {c.handedTo && <span className="text-slate-500"> · {etb(Number(c.countedCash) - Number(c.floatLeft))} to {c.handedTo}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This shift: since {shift.lastClosing ? `your closing at ${formatTime(shift.lastClosing.createdAt)}` : "the start of the day"} · {shift.payments} {shift.payments === 1 ? "payment" : "payments"}
            {Object.entries(shift.totals)
              .filter(([, v]) => Number(v) !== 0)
              .map(([k, v]) => ` · ${PAYMENT_METHODS[k]} ${etb(v!)}`)
              .join("")}
          </p>
          {shift.payments === 0 && mine.length > 0 ? (
            <p className="text-sm text-slate-500">Nothing taken since your last closing.</p>
          ) : (
            <CloseCashForm key={shift.lastClosing?.id ?? "first"} cashTaken={shift.cash} suggestedFloat={shift.suggestedFloat} />
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

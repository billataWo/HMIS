import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { api, type Me, type QueueVisit } from "@/lib/api";
import { formatDualDate } from "@/lib/format";

export const metadata: Metadata = { title: "Queue display · HMIS" };

// Shows only queue numbers and doctors, never patient names: the screen is in a public waiting room.
async function Board() {
  const [me, { day, visits }] = await Promise.all([
    api<Me>("/auth/me"),
    api<{ day: string; visits: QueueVisit[] }>("/queue"),
  ]);
  const serving = visits
    .filter((v) => v.status === "IN_CONSULTATION")
    .sort((a, b) => (b.calledAt ?? "").localeCompare(a.calledAt ?? ""));
  const next = visits.filter((v) => v.status === "WAITING").slice(0, 10);

  return (
    <>
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-3xl font-semibold">{me.tenant.name}</p>
          {me.tenant.nameAm && <p className="text-xl text-zinc-400">{me.tenant.nameAm}</p>}
        </div>
        <p className="text-xl text-zinc-400">{formatDualDate(`${day}T12:00:00+03:00`)}</p>
      </header>

      <section className="py-8">
        <h2 className="mb-4 text-2xl text-zinc-400">Now serving · አሁን የሚስተናገዱ</h2>
        {serving.length === 0 ? (
          <p className="text-3xl text-zinc-500">—</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {serving.map((v) => (
              <div key={v.id} className="rounded-2xl bg-teal-700 p-6">
                <p className="text-7xl font-bold tabular-nums sm:text-8xl">{v.queueNumber}</p>
                <p className="mt-2 text-2xl">{v.doctor ? `Dr. ${v.doctor.fullName}` : ""}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-white/10 py-8">
        <h2 className="mb-4 text-2xl text-zinc-400">Next · ቀጣይ</h2>
        {next.length === 0 ? (
          <p className="text-3xl text-zinc-500">—</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {next.map((v) => (
              <span key={v.id} className="rounded-xl bg-white/10 px-6 py-3 text-5xl font-semibold tabular-nums">
                {v.queueNumber}
              </span>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default function DisplayPage() {
  return (
    <main className="min-h-screen flex-1 bg-zinc-950 px-6 py-6 text-white sm:px-10">
      <AutoRefresh seconds={10} />
      <Suspense fallback={<p className="text-2xl text-zinc-500">Loading…</p>}>
        <Board />
      </Suspense>
    </main>
  );
}

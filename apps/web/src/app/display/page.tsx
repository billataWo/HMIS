// i18n: english-only — the waiting-room TV has no language setting: it shows English and Amharic
// side by side, written out here.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { CallPop } from "@/components/motion";
import { API_URL } from "@/lib/api";
import { formatDualDate, formatTime } from "@/lib/format";
import { Announcer } from "./announcer";
import { PairForm } from "./pair-form";

export const metadata: Metadata = { title: "Queue display" };

type Board = {
  clinic: { name: string; nameAm: string | null };
  day: string;
  serving: { id: string; queueNumber: number; doctor: string | null; room: string | null }[];
  next: { id: string; queueNumber: number; doctor: string | null; room: string | null }[];
  /** The recorded calling voice's version (null: none recorded yet). */
  voice?: string | null;
};

/**
 * The waiting-room TV. It uses its own display key (from pairing), never a staff sign-in, and the
 * board it reads holds only queue numbers and doctors: the screen is in a public waiting room.
 */
async function Screen() {
  const token = (await cookies()).get("hmis_display")?.value;
  if (!token) return <PairForm />;
  const res = await fetch(`${API_URL}/display/queue`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (res?.status === 401) return <PairForm removed />;
  if (!res?.ok) {
    return (
      <>
        <AutoRefresh seconds={15} />
        <div className="py-16 text-center text-slate-500">
          <p className="text-3xl">Waiting for the HMIS server…</p>
          <p className="mt-2 text-2xl">የHMIS ሰርቨሩን በመጠበቅ ላይ…</p>
        </div>
      </>
    );
  }
  const { clinic, day, serving, next, voice } = (await res.json()) as Board;

  return (
    <>
      {/* Every 5 seconds, so a call is heard within moments of the doctor pressing "Call in". */}
      <AutoRefresh seconds={5} />
      <Announcer calls={serving} voice={voice ?? null} />
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-3xl font-semibold">{clinic.name}</p>
          {clinic.nameAm && <p className="text-xl text-slate-400">{clinic.nameAm}</p>}
        </div>
        <div className="text-right">
          <p className="text-4xl font-semibold tabular-nums">{formatTime(new Date().toISOString())}</p>
          <p className="text-xl text-slate-400">{formatDualDate(`${day}T12:00:00+03:00`)}</p>
        </div>
      </header>

      {serving.length === 0 && next.length === 0 && (
        <section className="flex min-h-[60vh] flex-col items-center justify-center text-center">
          <p className="text-6xl font-semibold tracking-tight">Welcome</p>
          <p className="mt-2 text-5xl text-slate-300">እንኳን ደህና መጡ</p>
          <p className="mt-10 max-w-3xl text-3xl leading-snug text-slate-400">Please take a seat. Your number appears here when it is your turn.</p>
          <p className="mt-3 max-w-3xl text-3xl leading-snug text-slate-400">እባክዎ ይቀመጡ። ተራዎ ሲደርስ ቁጥርዎ እዚህ ይታያል።</p>
        </section>
      )}

      {(serving.length > 0 || next.length > 0) && (
      <>
      <section className="py-8">
        <h2 className="mb-4 text-2xl text-slate-400">Now serving · አሁን የሚስተናገዱ</h2>
        {serving.length === 0 ? (
          <p className="text-3xl text-slate-400">Nobody called yet · እስካሁን አልተጠራም</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {serving.map((v) => (
              <CallPop key={v.id} className="rounded-2xl bg-linear-to-br from-brand-600 to-brand-800 p-6 shadow-overlay">
                <p className="text-7xl font-bold tabular-nums sm:text-8xl">{v.queueNumber}</p>
                {v.room && (
                  <p className="mt-3 flex items-center gap-3 text-4xl font-semibold sm:text-5xl">
                    <ArrowRight aria-hidden className="size-9 shrink-0 sm:size-11" />
                    {v.room}
                  </p>
                )}
                {v.room && <p className="mt-1 text-2xl text-brand-100">ክፍል · Room</p>}
                <p className="mt-3 text-2xl text-brand-50">{v.doctor ? `Dr. ${v.doctor}` : ""}</p>
              </CallPop>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-white/10 py-8">
        <h2 className="mb-4 text-2xl text-slate-400">Next · ቀጣይ</h2>
        {next.length === 0 ? (
          <p className="text-3xl text-slate-400">Nobody waiting · የሚጠብቅ የለም</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {next.map((v) => (
              <span key={v.id} className="flex min-w-28 flex-col items-center rounded-xl bg-white/10 px-6 py-3">
                <span className="text-5xl font-semibold tabular-nums">{v.queueNumber}</span>
                {(v.room || v.doctor) && <span className="mt-1 text-lg text-slate-300">{v.room ?? `Dr. ${v.doctor}`}</span>}
              </span>
            ))}
          </div>
        )}
      </section>
      </>
      )}
    </>
  );
}

export default function DisplayPage() {
  return (
    <main className="min-h-screen flex-1 bg-slate-950 px-6 py-6 text-white sm:px-10">
      <Suspense fallback={<p className="text-2xl text-slate-500">Loading… · በመጫን ላይ…</p>}>
        <Screen />
      </Suspense>
    </main>
  );
}

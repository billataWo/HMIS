"use client";

// i18n: english-only — the waiting-room TV has no language setting: it shows English and Amharic
// side by side, written out here.

import { useActionState } from "react";
import { tr } from "@/lib/i18n";
import { type PairState, pairDisplay } from "./actions";

/** Big, simple form for a TV: typed with a remote or a keyboard, once. */
export function PairForm({ removed }: { removed?: boolean }) {
  const [state, action, pending] = useActionState<PairState, FormData>(pairDisplay, {});
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-4xl font-semibold">Connect this screen</h1>
      <p className="mt-1 text-2xl text-slate-300">ይህን ስክሪን ያገናኙ</p>
      <p className="mt-4 text-xl text-slate-400">
        {removed ? "This screen was removed or connected again elsewhere. " : ""}
        An admin opens HMIS → Settings → Screens, adds a screen and reads you a 6-digit code.
      </p>
      <p className="mt-2 text-xl text-slate-400">
        {removed ? "ይህ ስክሪን ተወግዷል ወይም በሌላ ቦታ እንደገና ተገናኝቷል። " : ""}
        አስተዳዳሪ HMIS → ቅንብሮች → ስክሪኖች ከፍቶ ስክሪን ይጨምርና ባለ 6 አሃዝ ኮድ ያነብልዎታል።
      </p>
      <form action={action} className="mt-10 space-y-6">
        <label className="block">
          <span className="sr-only">Pairing code · የማጣመሪያ ኮድ</span>
          <input
            name="code"
            required
            autoFocus
            inputMode="numeric"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="000000"
            className="w-72 rounded-2xl border-2 border-white/20 bg-white/5 px-6 py-4 text-center font-mono text-5xl tracking-[0.3em] text-white outline-none focus:border-brand-400"
          />
        </label>
        {state.error && (
          <div className="text-xl text-red-300">
            <p>{state.error}</p>
            {tr("am", state.error) !== state.error && <p className="mt-1">{tr("am", state.error)}</p>}
          </div>
        )}
        <button disabled={pending} className="rounded-2xl bg-brand-600 px-10 py-4 text-2xl font-semibold text-white hover:bg-brand-500 disabled:opacity-60">
          {pending ? "Connecting… · በማገናኘት ላይ…" : "Connect · አገናኝ"}
        </button>
      </form>
    </div>
  );
}

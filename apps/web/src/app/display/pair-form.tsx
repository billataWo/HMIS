"use client";

import { useActionState } from "react";
import { type PairState, pairDisplay } from "./actions";

/** Big, simple form for a TV: typed with a remote or a keyboard, once. */
export function PairForm({ removed }: { removed?: boolean }) {
  const [state, action, pending] = useActionState<PairState, FormData>(pairDisplay, {});
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-4xl font-semibold">Connect this screen</h1>
      <p className="mt-4 text-xl text-slate-400">
        {removed ? "This screen was removed or connected again elsewhere. " : ""}
        An admin opens HMIS → Settings → Screens, adds a screen and reads you a 6-digit code.
      </p>
      <form action={action} className="mt-10 space-y-6">
        <label className="block">
          <span className="sr-only">Pairing code</span>
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
        {state.error && <p className="text-xl text-red-300">{state.error}</p>}
        <button disabled={pending} className="rounded-2xl bg-brand-600 px-10 py-4 text-2xl font-semibold text-white hover:bg-brand-500 disabled:opacity-60">
          {pending ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}

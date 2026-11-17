"use client";

// i18n: english-only — the waiting-room TV has no language setting: it shows English and Amharic
// side by side, written out here.

import { useEffect } from "react";

/** The waiting-room TV has no one at the keyboard, so it keeps retrying on its own. */
export default function DisplayError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  useEffect(() => {
    const t = setInterval(() => retry(), 10_000);
    return () => clearInterval(t);
  }, [retry]);

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-slate-950 text-center text-white">
      <p className="text-3xl font-semibold">Reconnecting…</p>
      <p className="mt-2 text-xl text-slate-400">እንደገና በመገናኘት ላይ…</p>
    </main>
  );
}

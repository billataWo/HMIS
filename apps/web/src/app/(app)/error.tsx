"use client";

import { RotateCw, ServerCrash } from "lucide-react";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui";

/** Shown inside the app shell when a page fails to load, usually because the API is restarting or offline. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : undefined;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300">
        <ServerCrash aria-hidden className="size-6" />
      </span>
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">This page couldn&apos;t load</h1>
      <p className="mt-1 text-sm text-slate-500">
        The clinic server may be restarting or the network is down. Nothing you saved is lost. Try again in a moment.
      </p>
      <p className="mt-1 text-sm text-slate-500">ገጹ አልተጫነም። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።</p>
      <button onClick={() => retry()} className={`${buttonClass} mt-6`}>
        <RotateCw aria-hidden />
        Try again
      </button>
      {digest && <p className="mt-4 font-mono text-xs text-slate-500">Error reference {digest}</p>}
    </div>
  );
}

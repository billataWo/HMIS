"use client";

import { useSyncExternalStore } from "react";
import { CLINIC_TZ, formatDualDate } from "@/lib/format";
import { type Lang, tr } from "@/lib/i18n";

const noSubscribe = () => () => {};

/**
 * Reads the browser's clock after hydration (the server's clock and time zone may differ), so the
 * first paint shows the fallback and the client then shows the clinic's local date.
 */
function useClientValue<T extends string>(read: () => T, fallback: T): T {
  return useSyncExternalStore(noSubscribe, read, () => fallback);
}

const today = () => formatDualDate(new Date().toISOString());

function partOfDay() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: CLINIC_TZ }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** Today's date in both calendars. */
export function Today() {
  const label = useClientValue(today, "");
  return <p className="text-sm text-slate-500">{label}</p>;
}

/** "Good morning, Abebe" by the clinic's clock, with today's date in both calendars. */
export function Greeting({ name, lang = "en" }: { name: string; lang?: Lang }) {
  const date = useClientValue(today, "");
  const hello = tr(lang, useClientValue(partOfDay, "Welcome"));
  return (
    <div>
      <p className="h-5 text-sm font-medium text-brand-700 dark:text-brand-400">{date}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
        {hello}, {name}
      </h1>
    </div>
  );
}

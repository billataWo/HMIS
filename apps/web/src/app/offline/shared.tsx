"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueuePatient } from "@/lib/api";
import { type ExpiredMarker, getExpired, getOps, getSnapshot, purgeIfExpired } from "@/lib/offline/idb";
import type { Op, Snapshot } from "@/lib/offline/types";
import { buildView, type View } from "@/lib/offline/view";

/** The snapshot and queued work from this browser, re-read whenever either changes (any tab). */
export function useOfflineData() {
  const [data, setData] = useState<{ snap: Snapshot | null; ops: Op[]; expired: ExpiredMarker | null; loaded: boolean }>({ snap: null, ops: [], expired: null, loaded: false });
  const load = useCallback(async () => {
    await purgeIfExpired().catch(() => false);
    const [snap, ops, expired] = await Promise.all([getSnapshot().catch(() => undefined), getOps().catch(() => [] as Op[]), getExpired().catch(() => undefined)]);
    setData({ snap: snap ?? null, ops, expired: expired ?? null, loaded: true });
  }, []);
  useEffect(() => {
    // Reads IndexedDB (an external store) once mounted and whenever it changes.
    const first = window.setTimeout(() => void load(), 0);
    const onChange = () => void load();
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("hmis-offline");
      channel.onmessage = onChange;
    } catch {}
    window.addEventListener("hmis-offline-changed", onChange);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hmis-offline-changed", onChange);
      channel?.close();
    };
  }, [load]);
  // Rebuilt only when the stored data changes, not on every render.
  const view: View | null = useMemo(() => (data.snap ? buildView(data.snap, data.ops.filter((o) => o.userId === data.snap!.me.id)) : null), [data]);
  return { ...data, view, reload: load };
}

export type TabProps = { view: View; userId: string };

export const fullName = (p: Pick<QueuePatient, "firstName" | "fatherName"> & { grandfather?: string | null }) =>
  [p.firstName, p.fatherName, p.grandfather].filter(Boolean).join(" ");

export function PatientLine({ p }: { p: QueuePatient & { mrn: string } }) {
  return (
    <span className="min-w-0">
      <span className="font-medium text-slate-900 dark:text-white">{fullName(p)}</span>
      <span className="ml-2 font-mono text-xs text-slate-500">{p.mrn === "New" ? "new (number when sent)" : p.mrn}</span>
      {p.allergies?.length ? <span className="ml-2 text-xs font-medium text-red-700 dark:text-red-300">Allergies: {p.allergies.join(", ")}</span> : null}
    </span>
  );
}

export const money = (n: number | string) => `${Number(n).toFixed(2)} ETB`;

/** Waits for a queued action, keeping the button disabled meanwhile. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

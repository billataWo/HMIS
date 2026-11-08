"use client";

import { CircleAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { Me } from "@/lib/api";
import { cacheShell, refreshSnapshot, replay } from "@/lib/offline/engine";
import { clearSnapshot, getOps, getSnapshot, purgeIfExpired } from "@/lib/offline/idb";

type State = { online: boolean; snapshotAt: string | null; pending: number; failed: number };
let state: State = { online: true, snapshotAt: null, pending: 0, failed: 0 };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER_STATE: State = { online: true, snapshotAt: null, pending: 0, failed: 0 };

async function recount(userId: string) {
  const [ops, snap] = await Promise.all([getOps(), getSnapshot()]);
  set({
    pending: ops.filter((o) => o.status === "pending" && o.userId === userId).length,
    failed: ops.filter((o) => o.status === "failed" && o.userId === userId).length,
    snapshotAt: snap?.me.id === userId ? snap.at : null,
  });
}

/**
 * Keeps this PC ready to work offline, once per page: registers the service worker, keeps the
 * offline workspace and the user's working data in the browser, and sends work done offline
 * when the connection is back. Renders nothing.
 */
export function OfflineAgent({ me }: { me: Me }) {
  useEffect(() => {
    let stopped = false;
    const sync = async () => {
      if (stopped) return;
      if (!navigator.onLine) {
        set({ online: false });
        return;
      }
      const sent = await replay(me.id);
      set({ online: sent.stopped !== "offline" && sent.stopped !== "server" });
      if (sent.stopped === null) {
        const snap = await refreshSnapshot();
        if (snap) set({ online: true });
      }
      await recount(me.id);
    };

    void (async () => {
      if ("serviceWorker" in navigator) {
        if (process.env.NODE_ENV === "production") {
          await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
        } else {
          // `next dev` rebuilds files under the same names: a caching service worker would keep
          // serving old code. Development runs without it (test offline mode with a build).
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
          if ("caches" in window) for (const name of await caches.keys()) if (name.startsWith("hmis-")) await caches.delete(name);
        }
      }
      // Data from a sign-in that has run out, or from someone else, is not kept for the next person.
      await purgeIfExpired().catch(() => false);
      const snap = await getSnapshot().catch(() => undefined);
      if (snap && snap.me.id !== me.id) await clearSnapshot();
      await sync();
      if (process.env.NODE_ENV === "production") await cacheShell();
    })();

    const every = window.setInterval(() => void sync(), 3 * 60_000);
    const onOnline = () => void sync();
    const onOffline = () => set({ online: false });
    const onChanged = () => void recount(me.id);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("hmis-offline");
      channel.onmessage = onChanged;
    } catch {}
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("hmis-offline-changed", onChanged);
    return () => {
      stopped = true;
      window.clearInterval(every);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("hmis-offline-changed", onChanged);
      channel?.close();
    };
  }, [me.id]);
  return null;
}

/** The small status line in the sidebar: offline readiness, work waiting, work needing a look. */
export function OfflineChip() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  const base = "mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors";
  // A plain link (full page load): offline, the service worker answers with the cached workspace.
  if (s.failed) {
    return (
      <a href="/offline" className={`${base} bg-red-50 font-medium text-red-800 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-200`}>
        <CircleAlert aria-hidden className="size-3.5 shrink-0" />
        {s.failed} offline {s.failed === 1 ? "item needs" : "items need"} attention
      </a>
    );
  }
  if (!s.online) {
    return (
      <a href="/offline" className={`${base} bg-amber-50 font-medium text-amber-900 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-100`}>
        <CloudOff aria-hidden className="size-3.5 shrink-0" />
        Offline: open the offline workspace
      </a>
    );
  }
  if (s.pending) {
    return (
      <a href="/offline" className={`${base} bg-sky-50 text-sky-900 hover:bg-sky-100 dark:bg-sky-950/60 dark:text-sky-100`}>
        <CloudUpload aria-hidden className="size-3.5 shrink-0" />
        Sending {s.pending} offline {s.pending === 1 ? "item" : "items"}…
      </a>
    );
  }
  return (
    <a href="/offline" title="Open the offline workspace" className={`${base} text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200`}>
      <CloudCheck aria-hidden className="size-3.5 shrink-0" />
      {s.snapshotAt
        ? `Ready for offline · ${new Date(s.snapshotAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Addis_Ababa" })}`
        : "Preparing offline mode…"}
    </a>
  );
}

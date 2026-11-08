"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/ui";
import { getNames, getOps, purgeIfExpired } from "@/lib/offline/idb";

/**
 * On the sign-in page: work recorded offline on this PC that is still waiting to be sent, and
 * whose it is. It can only be sent once that person signs in (it is sent as them).
 */
export function OfflineWaiting() {
  const [waiting, setWaiting] = useState<{ name: string; count: number }[]>([]);
  useEffect(() => {
    if (!("indexedDB" in window)) return;
    void (async () => {
      try {
        // Signed out: patient data from a sign-in that has run out is deleted from this browser.
        await purgeIfExpired();
        const [ops, names] = await Promise.all([getOps(), getNames()]);
        const counts = new Map<string, number>();
        for (const op of ops) if (op.status !== "done") counts.set(op.userId, (counts.get(op.userId) ?? 0) + 1);
        setWaiting([...counts].map(([id, count]) => ({ name: names[id] ?? "someone who worked on this PC", count })));
      } catch {
        // no offline store in this browser: nothing waiting
      }
    })();
  }, []);
  if (!waiting.length) return null;
  return (
    <Notice tone="warning" className="mb-6">
      {waiting.map((w) => (
        <p key={w.name}>
          {w.count} {w.count === 1 ? "item" : "items"} recorded offline by <span className="font-medium">{w.name}</span> {w.count === 1 ? "is" : "are"} waiting
          to be sent.
        </p>
      ))}
      <p className="mt-1">Each person&apos;s work is sent as soon as they sign in on this PC.</p>
    </Notice>
  );
}

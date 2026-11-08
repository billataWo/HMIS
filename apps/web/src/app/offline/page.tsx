import type { Metadata } from "next";
import { OfflineWorkspace } from "./workspace";

export const metadata: Metadata = { title: "Offline workspace" };

/**
 * Works with no connection: a static page (kept by the service worker) whose workspace reads and
 * writes only this browser's offline store, and sends queued work when the server is reachable.
 */
export default function OfflinePage() {
  return <OfflineWorkspace />;
}

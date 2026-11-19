"use client";

import { useEffect } from "react";
import { StatusPage } from "@/components/status-page";
import { errorReference, pageStatus } from "@/lib/http-status";

/**
 * Shown inside the app's frame when a page fails to load, with the status the API gave: no access
 * (403), not found (404), the server can't be reached (503, usually restarting or the network is
 * down), or anything else (500).
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const status = pageStatus(error);
  return <StatusPage status={status} reference={status === 500 ? errorReference(error) : undefined} onRetry={() => retry()} />;
}

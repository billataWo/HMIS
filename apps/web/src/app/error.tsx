"use client";

import { useEffect } from "react";
import { StandaloneStatus } from "@/components/standalone-status";
import { errorReference, pageStatus } from "@/lib/http-status";

/** A page outside the app's frame (sign-in, receipts, printouts), or the app's own frame, that failed to load. */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const status = pageStatus(error);
  return <StandaloneStatus status={status} reference={status === 500 ? errorReference(error) : undefined} onRetry={() => retry()} />;
}

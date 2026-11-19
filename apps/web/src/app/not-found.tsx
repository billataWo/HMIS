import type { Metadata } from "next";
import { StandaloneStatus } from "@/components/standalone-status";

export const metadata: Metadata = { title: "Page not found" };

/** An address that matches no page at all (404), on its own screen. */
export default function NotFound() {
  return <StandaloneStatus status={404} />;
}

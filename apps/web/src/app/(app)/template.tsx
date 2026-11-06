import type { ReactNode } from "react";
import { PageTransition } from "@/components/enter";

/** Re-mounts on every navigation inside the app, so each page eases in. */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}

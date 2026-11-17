import type { ReactNode } from "react";
import { LangBoundary } from "@/components/lang-boundary";

/** The sign-in screens follow the language chosen on this browser (public site or the app). */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return <LangBoundary className="flex flex-1 flex-col">{children}</LangBoundary>;
}

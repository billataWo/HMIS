import { Suspense, type ReactNode } from "react";
import { LangProvider } from "@/components/lang-provider";
import { getLang } from "@/lib/lang";

async function WithLang({ children, className }: { children: ReactNode; className?: string }) {
  const lang = await getLang();
  return (
    <LangProvider lang={lang}>
      <div lang={lang} className={className}>
        {children}
      </div>
    </LangProvider>
  );
}

/**
 * The browser's language (a cookie) for everything inside: client components get it from
 * `useT()`, server components from `getT()`. Reading a cookie is request data, so it sits in a
 * Suspense boundary; the fallback shows only until the cookie is read.
 */
export function LangBoundary({ children, className = "contents", fallback = null }: { children: ReactNode; className?: string; fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <WithLang className={className}>{children}</WithLang>
    </Suspense>
  );
}

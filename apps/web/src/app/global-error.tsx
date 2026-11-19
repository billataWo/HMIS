"use client";

import "./globals.css";
import { useEffect, useSyncExternalStore } from "react";
import { LangProvider } from "@/components/lang-provider";
import { useCookieLang } from "@/components/standalone-status";
import { StatusPage } from "@/components/status-page";
import { errorReference, pageStatus } from "@/lib/http-status";

const noSubscribe = () => () => {};
const cookie = (name: string) => (typeof document === "undefined" ? undefined : new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie)?.[1]);
/** The Day / Dark choice (components/theme-switch.tsx): this page replaces the root layout that applies it. */
const readTheme = () => {
  const v = cookie("hmis_theme");
  return v === "light" || v === "dark" ? v : "";
};

/**
 * The last resort: the root layout itself failed (it replaces the whole document). Same status
 * page as elsewhere, with its own <html>, styles, theme and language.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const lang = useCookieLang();
  const theme = useSyncExternalStore(noSubscribe, readTheme, () => "");
  const status = pageStatus(error);
  return (
    <html lang={lang} data-theme={theme || undefined} className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* i18n-ignore: the browser tab's title, in both languages */}
        <title>{status === 503 ? "HMIS · ሰርቨሩ አይገኝም / Server unreachable" : "HMIS · ስህተት / Error"}</title>
        <LangProvider lang={lang}>
          <StatusPage status={status} variant="page" reference={status === 500 ? errorReference(error) : undefined} onRetry={() => retry()} />
        </LangProvider>
      </body>
    </html>
  );
}

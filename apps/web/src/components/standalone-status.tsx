"use client";

import { useSyncExternalStore } from "react";
import { LangProvider } from "@/components/lang-provider";
import { StatusPage } from "@/components/status-page";
import type { PageStatus } from "@/lib/http-status";
import type { Lang } from "@/lib/i18n";

const noSubscribe = () => () => {};
/** The language chosen in HMIS (the hmis_lang cookie), read in the browser: these pages are static or outside the app. */
const readLang = (): Lang => (/(?:^|;\s*)hmis_lang=am(?:;|$)/.test(document.cookie) ? "am" : "en");
export const useCookieLang = () => useSyncExternalStore(noSubscribe, readLang, (): Lang => "en");

/** A status page on its own screen (outside the app's frame), in the language chosen in HMIS. */
export function StandaloneStatus(props: { status: PageStatus; reference?: string; onRetry?: () => void }) {
  return (
    <LangProvider lang={useCookieLang()}>
      <StatusPage variant="page" {...props} />
    </LangProvider>
  );
}

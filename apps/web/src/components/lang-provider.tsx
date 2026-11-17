"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeT, type Lang, type T } from "@/lib/i18n";

const LangContext = createContext<Lang>("en");

/** Gives client components the signed-in browser's language (set by the app and print layouts). */
export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** The translator for client components: `const t = useT(); t("Save")`. */
export function useT(): T {
  const lang = useContext(LangContext);
  return useMemo(() => makeT(lang), [lang]);
}

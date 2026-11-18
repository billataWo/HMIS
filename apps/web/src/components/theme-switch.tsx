"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

/** The Day / Dark choice, read before the first paint by the script in app/layout.tsx. */
export const THEME_COOKIE = "hmis_theme";
type Theme = "light" | "dark";

/** The theme showing now: the saved choice, otherwise the device's setting. */
function current(): Theme {
  const saved = document.documentElement.dataset.theme;
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener("hmis-theme", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("hmis-theme", onChange);
  };
}

/** Saves the choice for a year and applies it at once: no reload. */
function choose(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event("hmis-theme"));
}

/**
 * Day or Dark. Until someone chooses, the screen follows the device's setting. `look` matches the
 * language switch next to it: the app's sidebar, or the public site and sign-in.
 */
export function ThemeSwitch({ label, day, dark, look = "app", className = "" }: { label: string; day: string; dark: string; look?: "app" | "site"; className?: string }) {
  // Null on the server and in the first render: the theme is only known in the browser.
  const theme = useSyncExternalStore(subscribe, current, () => null);
  const option = (value: Theme, text: string, Icon: typeof Sun) => {
    const on = theme === value;
    const style =
      look === "app"
        ? on
          ? "bg-brand-700 text-white"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
        : on
          ? "bg-(--l-ink) text-(--l-paper)"
          : "text-(--l-muted) hover:bg-black/5 hover:text-(--l-ink) dark:hover:bg-white/10";
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => choose(value)}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${style}`}
      >
        <Icon aria-hidden className="size-3.5" />
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-label={label} className={`flex items-center gap-0.5 ${className}`}>
      {option("light", day, Sun)}
      {option("dark", dark, Moon)}
    </div>
  );
}

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
 * A Day / Dark toggle: a sun and a moon on a track, the knob on the theme showing; one click
 * switches. Until someone chooses, the screen follows the device's setting. `look` matches the
 * language switch next to it: the app's sidebar, or the public site and sign-in.
 */
export function ThemeSwitch({ label, day, dark, look = "app", className = "" }: { label: string; day: string; dark: string; look?: "app" | "site"; className?: string }) {
  // Null on the server and in the first render: the theme is only known in the browser.
  const theme = useSyncExternalStore(subscribe, current, () => null);
  const isDark = theme === "dark";
  const track = look === "app" ? "bg-slate-200 dark:bg-slate-700" : "bg-black/10 dark:bg-white/15";
  const knob = look === "app" ? "bg-white text-brand-700 dark:bg-slate-900 dark:text-brand-300" : "bg-(--l-paper) text-(--l-ink)";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`${label}: ${isDark ? dark : day}`}
      title={isDark ? day : dark}
      onClick={() => choose(isDark ? "light" : "dark")}
      className={`relative inline-flex h-7 w-13 shrink-0 items-center rounded-full ${track} transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${className}`}
    >
      {/* The two ends: the sun on the left, the moon on the right. */}
      <Sun aria-hidden className="absolute left-1.5 size-3.5 text-slate-500 dark:text-slate-400" />
      <Moon aria-hidden className="absolute right-1.5 size-3.5 text-slate-500 dark:text-slate-400" />
      {/* The knob, on the theme showing (hidden until it is known, so it never jumps). */}
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 grid size-6 place-items-center rounded-full shadow-sm transition-transform duration-200 ${knob} ${isDark ? "translate-x-6" : "translate-x-0"} ${theme ? "" : "opacity-0"}`}
      >
        {isDark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      </span>
    </button>
  );
}

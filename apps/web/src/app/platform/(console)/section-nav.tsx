"use client";

import { useEffect, useState } from "react";

/**
 * Jump links for a long page, kept under the console's header while scrolling. The section being
 * read is marked (aria-current), so the operator always knows where they are.
 */
export function SectionNav({ sections }: { sections: { id: string; label: string; count?: number }[] }) {
  const [current, setCurrent] = useState(sections[0]?.id);
  useEffect(() => {
    let frame = 0;
    // The section whose top has passed the line under the sticky bars; at the very bottom of the
    // page, the last one (it may never reach that line).
    const update = () => {
      frame = 0;
      const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
      if (!els.length) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const passed = els.filter((el) => el.getBoundingClientRect().top <= 140);
      const el = atBottom ? els.at(-1)! : (passed.at(-1) ?? els[0]);
      setCurrent(el.id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);

  return (
    <nav
      aria-label="On this page"
      className="sticky top-14 z-20 -mx-4 border-b border-slate-200 bg-slate-50/90 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-xl lg:border lg:bg-white/90 lg:px-2 print:hidden dark:border-slate-800 dark:bg-slate-950/90 lg:dark:bg-slate-900/90"
    >
      <ul className="flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:none]">
        {sections.map((s) => {
          const on = s.id === current;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={on ? "location" : undefined}
                onClick={() => setCurrent(s.id)}
                className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
                  on ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
              >
                {s.label}
                {s.count ? <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white tabular-nums">{s.count}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

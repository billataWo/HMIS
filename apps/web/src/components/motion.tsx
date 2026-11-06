"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Motion vocabulary for the whole app. Clinical screens are read under time pressure, so motion
 * only orients (where did this come from, what changed) and never delays: short entrances,
 * faster exits, small offsets, no overshoot. Users with "reduce motion" get instant changes.
 * Page, list and tile entrances are CSS-only (./enter.tsx) so they never depend on JavaScript.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const DURATION = { enter: 0.24, exit: 0.16, stagger: 0.035 } as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DURATION.enter, ease: EASE }}>
      {children}
    </MotionConfig>
  );
}

/**
 * A newly called queue number on the waiting-room screen: it scales in and a ring pulses three
 * times so people looking up from across the room notice it. Stays mounted across auto-refreshes
 * (keyed by visit), so only new calls animate.
 */
export function CallPop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // The card itself enters with CSS (always visible); only the decorative ring needs JavaScript.
    <div className={`enter relative ${className ?? ""}`} style={{ "--enter-y": "12px" } as React.CSSProperties}>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-4 ring-brand-300"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.9, 0], scale: [1, 1.06] }}
        transition={{ duration: 1.2, ease: "easeOut", repeat: 2 }}
      />
      {children}
    </div>
  );
}

/** Reveal for content that appears in place (alerts, banners). Transform and opacity only. */
export function Reveal({ show, children, className, appear = false }: { show: boolean; children: ReactNode; className?: string; appear?: boolean }) {
  return (
    <AnimatePresence initial={appear}>
      {show && (
        <motion.div
          className={className}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: DURATION.exit } }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

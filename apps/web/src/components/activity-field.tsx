"use client";

import UseAnimations from "react-useanimations";
import activity from "react-useanimations/lib/activity";

/**
 * One heartbeat (the useanimations.com "activity" icon, MIT) looping slowly behind the deep-teal
 * panels of the sign-in and front page. It is drawn large but with a thin line (the stroke keeps
 * its width in screen pixels however big the icon is), faint enough that text over it stays easy
 * to read. Decoration only: hidden from screen readers, and still when reduced motion is preferred.
 */
export function HeartbeatBackground({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 grid place-items-center overflow-hidden ${className}`}>
      <UseAnimations
        animation={activity}
        interaction="loop"
        autoplay
        loop
        speed={0.45}
        size="min(78vmin, 640px)"
        strokeColor="currentColor"
        className="text-cyan-200/20 [&_path]:stroke-[2.5px] [&_path]:[vector-effect:non-scaling-stroke]"
      />
    </div>
  );
}

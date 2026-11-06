import type { ComponentProps, CSSProperties, ReactNode } from "react";

/*
 * Entrance animations done in CSS (see `.enter` and `.stagger` in globals.css), so they need no
 * client JavaScript and never leave content hidden if scripts don't load. Interactive motion
 * (menu, banners, active-nav marker, waiting-room pop) lives in ./motion.tsx.
 */

/** Page entrance used by route templates. */
export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="enter">{children}</div>;
}

export function FadeIn({ children, delay = 0, className = "", y = 8 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <div className={`enter ${className}`} style={{ "--enter-delay": `${delay * 1000}ms`, "--enter-y": `${y}px` } as CSSProperties}>
      {children}
    </div>
  );
}

/** A list whose rows rise in one after another on first render. */
export function StaggerList({ className = "", ...props }: ComponentProps<"ul">) {
  return <ul className={`stagger ${className}`} {...props} />;
}

export function StaggerItem(props: ComponentProps<"li">) {
  return <li {...props} />;
}

export function StaggerGrid({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`stagger ${className}`} {...props} />;
}

export function StaggerCell(props: ComponentProps<"div">) {
  return <div {...props} />;
}

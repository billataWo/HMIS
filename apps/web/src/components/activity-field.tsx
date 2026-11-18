import type { CSSProperties } from "react";

/** Width of one heartbeat in the drawing, and how many fill the trace. */
const BEAT = 300;
const BEATS = 4;
const WIDTH = BEAT * BEATS;
const BASE = 60; // the isoelectric line

/**
 * One beat of a normal sinus rhythm (lead II), left to right: the baseline, the small rounded P wave
 * (the atria), a short flat PR segment, the QRS complex (a small Q dip, the tall sharp R spike, a deep
 * S), the flat ST segment, the broad rounded T wave, and the baseline again until the next beat.
 */
function beat(x: number) {
  const at = (dx: number) => x + dx;
  return [
    `L${at(40)} ${BASE}`,
    // P wave
    `C${at(46)} ${BASE} ${at(50)} ${BASE - 9} ${at(57)} ${BASE - 9}`,
    `C${at(64)} ${BASE - 9} ${at(68)} ${BASE} ${at(74)} ${BASE}`,
    // PR segment
    `L${at(88)} ${BASE}`,
    // QRS complex
    `L${at(92)} ${BASE + 6}`,
    `L${at(99)} ${BASE - 50}`,
    `L${at(106)} ${BASE + 18}`,
    `L${at(111)} ${BASE}`,
    // ST segment
    `L${at(128)} ${BASE}`,
    // T wave
    `C${at(138)} ${BASE} ${at(146)} ${BASE - 15} ${at(158)} ${BASE - 15}`,
    `C${at(170)} ${BASE - 15} ${at(176)} ${BASE} ${at(188)} ${BASE}`,
    `L${at(BEAT)} ${BASE}`,
  ].join(" ");
}

const TRACE = `M0 ${BASE} ${Array.from({ length: BEATS }, (_, i) => beat(i * BEAT)).join(" ")}`;

/** The sweeping pen: a long dim tail, a brighter stretch behind the pen, and the pen itself, glowing. */
const LAYERS: { tail: number; opacity: number; width: number; glow?: boolean }[] = [
  { tail: 520, opacity: 0.35, width: 1.75 },
  { tail: 150, opacity: 0.7, width: 2 },
  { tail: 14, opacity: 1, width: 3, glow: true },
];

/**
 * A heartbeat on a bedside monitor, behind the deep-teal panels of the sign-in and front page: a
 * normal ECG (P, QRS, T) at 72 beats a minute, drawn by a glowing pen sweeping left to right with
 * its trace fading behind it, over the faint trace of the sweep before. Thin and faint, so text over
 * it stays easy to read. Decoration only: hidden from screen readers; with reduced motion, only the
 * still trace shows. `style` places the band.
 */
export function HeartbeatBackground({ className = "", style = { top: "calc(50% - 10rem)" } }: { className?: string; style?: CSSProperties }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 h-28 text-emerald-300 ${className}`} style={style}>
      <svg viewBox={`0 0 ${WIDTH} 120`} preserveAspectRatio="none" className="h-full w-full [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
        {/* The sweep before, still on the screen. */}
        <path d={TRACE} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {LAYERS.map((l) => (
          <path
            key={l.tail}
            d={TRACE}
            pathLength={1000}
            fill="none"
            stroke="currentColor"
            strokeOpacity={l.opacity}
            strokeWidth={l.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={`ecg-sweep ${l.glow ? "[filter:drop-shadow(0_0_4px_currentColor)_drop-shadow(0_0_10px_currentColor)]" : ""}`}
            style={{ "--tail": l.tail } as CSSProperties}
          />
        ))}
      </svg>
    </div>
  );
}

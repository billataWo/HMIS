"use client";

import { ClipboardCheck, FlaskConical, Pause, Pill, Play, Receipt, Stethoscope, UserPlus } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/i18n";

const noSubscribe = () => () => {};

const ICONS = [UserPlus, Receipt, Stethoscope, FlaskConical, Pill, ClipboardCheck];
const STEP_COUNT = ICONS.length;

const COPY = {
  en: {
    label: "A visit in HMIS",
    list: "A patient's visit in HMIS",
    play: "Play",
    pause: "Pause",
    steps: [
      ["Check-in", "Register or find the patient; they get a queue number"],
      ["Pay first", "Cash, telebirr or Chapa before each service, if you want it"],
      ["Consultation", "Vitals, notes, ICD-11 diagnoses and orders"],
      ["Lab", "Orders arrive at the bench; results go back to the doctor"],
      ["Pharmacy", "Prescriptions dispensed from stock, by batch and expiry"],
      ["Done", "Receipt printed, visit closed, follow-up booked"],
    ],
  },
  am: {
    label: "በHMIS ውስጥ አንድ ጉብኝት",
    list: "የታካሚ ጉብኝት በHMIS",
    play: "አጫውት",
    pause: "አቁም",
    steps: [
      ["መቀበያ", "ታካሚውን ይመዝግቡ ወይም ይፈልጉ፤ የወረፋ ቁጥር ይሰጣቸዋል"],
      ["ቅድሚያ ክፍያ", "ከፈለጉ ከእያንዳንዱ አገልግሎት በፊት በጥሬ ገንዘብ፣ በቴሌብር ወይም በቻፓ"],
      ["የሐኪም ምርመራ", "ቫይታል ሳይንስ፣ ማስታወሻዎች፣ የICD-11 ምርመራዎችና ትዕዛዞች"],
      ["ላብራቶሪ", "ትዕዛዞች ላብራቶሪ ይደርሳሉ፤ ውጤቶች ወደ ሐኪሙ ይመለሳሉ"],
      ["ፋርማሲ", "ማዘዣዎች ከክምችት፣ በባችና በማብቂያ ቀን ቅደም ተከተል ይታደላሉ"],
      ["ተጠናቀቀ", "ደረሰኝ ታትሟል፣ ጉብኝቱ ተዘግቷል፣ ክትትል ተይዟል"],
    ],
  },
} satisfies Record<Lang, unknown>;

const STEP_MS = 2400;
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * A patient's visit, as the clinic sees it in HMIS: the current step moves down the list on its
 * own. It stops while the pointer or keyboard is on it, while it is off screen, when the visitor
 * pauses it, and entirely for people who ask for reduced motion (then every step simply shows).
 */
export function VisitFlow({ lang = "en" }: { lang?: Lang }) {
  const t = COPY[lang];
  const STEPS = t.steps.map(([title, text], i) => ({ icon: ICONS[i], title, text }));
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  // The server cannot know the visitor's motion setting: the first render is the still list.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const animated = mounted && !reduce;
  const running = animated && inView && !held && !paused;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setActive((a) => (a + 1) % STEP_COUNT), STEP_MS);
    return () => clearInterval(timer);
  }, [running]);

  const progress = active / (STEP_COUNT - 1);

  return (
    <div
      ref={ref}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="relative rounded-2xl bg-white/6 p-5 ring-1 ring-white/15 backdrop-blur-sm sm:p-6"
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-brand-100/80 uppercase">
          <span className="relative flex size-2">
            {animated && !paused && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          {t.label}
        </p>
        {animated && (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-brand-100/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
          >
            {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
            {paused ? t.play : t.pause}
          </button>
        )}
      </div>

      <ol aria-label={t.list} className="relative">
        {/* The track, and how far the patient has come along it. */}
        <span aria-hidden className="absolute top-5 bottom-5 left-4.75 w-px bg-white/15" />
        {animated && (
          <motion.span
            aria-hidden
            className="absolute top-5 bottom-5 left-4.75 w-px origin-top bg-linear-to-b from-cyan-300 to-emerald-300"
            initial={false}
            animate={{ scaleY: progress }}
            transition={{ duration: 0.6, ease: EASE }}
          />
        )}
        {STEPS.map((s, i) => {
          const isActive = animated && i === active;
          const isDone = animated && i < active;
          return (
            <li key={s.title} className="relative flex gap-4 pb-5 last:pb-0">
              <span
                className={`relative z-10 grid size-10 shrink-0 place-items-center rounded-xl ring-1 transition-colors duration-300 ${
                  isActive ? "bg-white text-brand-800 ring-white" : isDone ? "bg-emerald-400/20 text-emerald-100 ring-emerald-300/40" : "bg-brand-900 text-white ring-white/20"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="visit-active"
                    aria-hidden
                    className="absolute -inset-1.5 rounded-2xl ring-2 ring-cyan-300/60"
                    transition={{ duration: 0.5, ease: EASE }}
                  />
                )}
                <s.icon aria-hidden className="size-4.5" />
              </span>
              <div className={`pt-0.5 transition-opacity duration-300 ${animated && !isActive && !isDone ? "opacity-70" : "opacity-100"}`}>
                <p className="font-medium">{s.title}</p>
                <p className="text-sm text-brand-100/75">{s.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

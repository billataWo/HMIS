"use client";

import { BellRing, CircleCheck, FlaskConical } from "lucide-react";
import { type CSSProperties, useEffect, useRef } from "react";
import type { Lang } from "@/lib/i18n";

/** The queue as the front desk sees it. Example names; the screen is drawn, not a photograph. */
const COPY = {
  en: {
    sr: "An illustration of the HMIS queue screen: who is waiting, who is with the doctor, at the lab or at the cashier.",
    title: "Queue · Outpatient",
    summary: "Today · 5 waiting · 23 seen",
    tabs: ["All", "Doctor", "Lab", "Cashier"],
    rows: [
      { n: 12, name: "Selam Tesfaye", detail: "Dr. Hana · Room 2", status: "In consultation", tone: "ok" },
      { n: 13, name: "Dawit Haile", detail: "Lab · CBC, malaria RDT", status: "At the lab", tone: "accent" },
      { n: 14, name: "Meron Alemu", detail: "Dr. Hana · Room 2", status: "Called", tone: "warn" },
      { n: 15, name: "Abebe Kebede", detail: "Paid · telebirr", status: "Waiting", tone: "muted" },
      { n: 16, name: "Hiwot Girma", detail: "Pay first: 350 ETB", status: "At the cashier", tone: "muted" },
    ],
    paid: "Paid · telebirr",
    receipt: "350.00 ETB · receipt R-0418",
    result: "Result ready · Hb",
    range: "13.2 g/dL · range 12–16",
    calling: "Now calling #14 · Room 2",
  },
  am: {
    sr: "የHMIS የወረፋ ገጽ ምስል፦ ማን እየጠበቀ እንዳለ፣ ማን ከሐኪሙ ጋር፣ ላብራቶሪ ወይም ገንዘብ ተቀባይ ዘንድ እንዳለ።",
    title: "ወረፋ · የተመላላሽ ታካሚ",
    summary: "ዛሬ · 5 በመጠባበቅ · 23 ታይተዋል",
    tabs: ["ሁሉም", "ሐኪም", "ላብራቶሪ", "ገንዘብ ተቀባይ"],
    rows: [
      { n: 12, name: "ሰላም ተስፋዬ", detail: "ዶ/ር ሐና · ክፍል 2", status: "በምርመራ ላይ", tone: "ok" },
      { n: 13, name: "ዳዊት ኃይሌ", detail: "ላብራቶሪ · CBC፣ የወባ ምርመራ", status: "ላብራቶሪ", tone: "accent" },
      { n: 14, name: "ሜሮን አለሙ", detail: "ዶ/ር ሐና · ክፍል 2", status: "ተጠርቷል", tone: "warn" },
      { n: 15, name: "አበበ ከበደ", detail: "ተከፍሏል · ቴሌብር", status: "በመጠባበቅ ላይ", tone: "muted" },
      { n: 16, name: "ሕይወት ግርማ", detail: "ቅድሚያ ክፍያ፦ 350 ብር", status: "ገንዘብ ተቀባይ ዘንድ", tone: "muted" },
    ],
    paid: "ተከፍሏል · ቴሌብር",
    receipt: "350.00 ብር · ደረሰኝ R-0418",
    result: "ውጤት ዝግጁ ነው · Hb",
    range: "13.2 g/dL · ክልል 12–16",
    calling: "አሁን የሚጠራ #14 · ክፍል 2",
  },
} satisfies Record<Lang, unknown>;

const TONE: Record<string, string> = {
  ok: "bg-emerald-500/12 text-(--l-ok)",
  accent: "bg-(--l-accent-soft) text-(--l-accent)",
  warn: "bg-amber-500/14 text-(--l-warn)",
  muted: "bg-slate-500/10 text-(--l-muted)",
};

const REST = { rx: 7, ry: -14 };
const RANGE = { rx: 6, ry: 10 };

/**
 * The hero's product scene. The pointer tilts it a little (eased, one animation frame at a time,
 * and only while something is still moving); it rests at a three-quarter angle. Nothing moves for
 * touch screens or for people who ask for reduced motion. Decorative: screen readers get one line.
 */
export function ProductStage({ lang = "en" }: { lang?: Lang }) {
  const t = COPY[lang];
  const stage = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    const target = tilt.current;
    if (!el || !target) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce), (hover: none)");
    if (still.matches) return;

    let want = { ...REST };
    const now = { ...REST };
    let frame = 0;
    const step = () => {
      now.rx += (want.rx - now.rx) * 0.08;
      now.ry += (want.ry - now.ry) * 0.08;
      target.style.setProperty("--rx", `${now.rx.toFixed(2)}deg`);
      target.style.setProperty("--ry", `${now.ry.toFixed(2)}deg`);
      frame = Math.abs(want.rx - now.rx) + Math.abs(want.ry - now.ry) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    const go = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      want = { rx: REST.rx - y * RANGE.rx, ry: REST.ry + x * RANGE.ry };
      go();
    };
    const leave = () => {
      want = { ...REST };
      go();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={stage} className="stage relative mx-auto w-full max-w-xl py-6 select-none">
      <p className="sr-only">{t.sr}</p>
      <div ref={tilt} aria-hidden className="stage-tilt relative">
        {/* The screen. */}
        <div className="stage-layer overflow-hidden rounded-2xl bg-(--l-paper) text-(--l-ink) shadow-[0_40px_80px_-30px_rgb(0_0_0/0.55)] ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex items-center gap-1.5 border-b border-(--l-line) px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-[#f87171]" />
            <span className="size-2.5 rounded-full bg-[#fbbf24]" />
            <span className="size-2.5 rounded-full bg-[#34d399]" />
            <span className="ml-3 truncate rounded-md bg-(--l-canvas) px-2.5 py-0.5 font-mono text-[10px] text-(--l-muted)">hmis.app.aletcloud.com/queue</span>
          </div>
          <div className="px-4 pt-3 pb-4 sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">{t.title}</p>
              <p className="font-mono text-[10px] text-(--l-muted) tabular-nums">{t.summary}</p>
            </div>
            <div className="mt-2 flex gap-1 text-[10px] font-medium">
              {t.tabs.map((t, i) => (
                <span key={t} className={`rounded-md px-2 py-0.5 ${i === 0 ? "bg-(--l-ink) text-(--l-paper)" : "text-(--l-muted)"}`}>
                  {t}
                </span>
              ))}
            </div>
            <ul className="mt-3 divide-y divide-(--l-line)">
              {t.rows.map((r) => (
                <li key={r.n} className="flex items-center gap-3 py-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--l-canvas) font-mono text-[11px] font-semibold tabular-nums">{r.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{r.name}</span>
                    <span className="block truncate text-[10px] text-(--l-muted)">{r.detail}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE[r.tone]}`}>{r.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Notes floating in front, each at its own depth. */}
        <div className="stage-layer absolute -top-2 -right-3 sm:-right-8" style={{ "--z": "90px" } as CSSProperties}>
          <div className="stage-bob flex items-center gap-2 rounded-xl bg-(--l-paper) px-3 py-2 text-(--l-ink) shadow-[0_18px_40px_-16px_rgb(0_0_0/0.5)] ring-1 ring-black/5 dark:ring-white/10">
            <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/12 text-(--l-ok)">
              <CircleCheck className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-[11px] font-semibold">{t.paid}</span>
              <span className="block font-mono text-[10px] text-(--l-muted) tabular-nums">{t.receipt}</span>
            </span>
          </div>
        </div>
        <div className="stage-layer absolute -bottom-4 -left-3 sm:-left-10" style={{ "--z": "120px" } as CSSProperties}>
          <div className="stage-bob-2 flex items-center gap-2 rounded-xl bg-(--l-paper) px-3 py-2 text-(--l-ink) shadow-[0_18px_40px_-16px_rgb(0_0_0/0.5)] ring-1 ring-black/5 dark:ring-white/10">
            <span className="grid size-7 place-items-center rounded-lg bg-(--l-accent-soft) text-(--l-accent)">
              <FlaskConical className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-[11px] font-semibold">{t.result}</span>
              <span className="block font-mono text-[10px] text-(--l-muted) tabular-nums">{t.range}</span>
            </span>
          </div>
        </div>
        <div className="stage-layer absolute -right-2 -bottom-5 hidden sm:block" style={{ "--z": "60px" } as CSSProperties}>
          <div className="stage-bob-3 flex items-center gap-2 rounded-xl bg-(--l-ink) px-3 py-2 text-(--l-paper) shadow-[0_18px_40px_-16px_rgb(0_0_0/0.6)]">
            <BellRing className="size-4" />
            <span className="text-[11px] font-semibold">{t.calling}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { callKeys, canSay, decodePack, playClips, type VoiceLang, type VoicePack } from "@/lib/voice";

export type Call = { id: string; queueNumber: number; doctor: string | null; room: string | null };

/**
 * Voice calls for the waiting-room TV: when a doctor calls someone in, a chime, then the call in
 * Amharic and in English, said twice: "ተራ ቁጥር አስራ ሁለት፣ እባክዎ ወደ ክፍል ሁለት ይግቡ" / "Number twelve.
 * Please go to room two."
 *
 * The voice is the one HMIS recorded (platform console → Voice), the same in every clinic. A
 * language not fully recorded yet is said by the device's own voice instead: English always,
 * Amharic only where the device has an Amharic voice (most TVs and Windows PCs do not).
 *
 * Browsers only play sound after someone has touched the page once, so a TV that was just
 * switched on shows a "tap to turn on" button until it is tapped. A kiosk browser started with
 * --autoplay-policy=no-user-gesture-required speaks straight away.
 */

const PREF = "hmis.display.voice"; // "off" when voice calls are muted on this TV

/** "Room 2" is read as "ክፍል 2" in Amharic; any other room name is read as written. */
function roomAm(room: string) {
  const m = /^room\s*(.+)$/i.exec(room.trim());
  return m ? `ክፍል ${m[1]}` : room;
}

export function callLines(c: Call) {
  const n = c.queueNumber;
  if (c.room) return { en: `Number ${n}. Please go to ${c.room}.`, am: `ተራ ቁጥር ${n}፣ እባክዎ ወደ ${roomAm(c.room)} ይግቡ።` };
  if (c.doctor) return { en: `Number ${n}. Please go to Doctor ${c.doctor}.`, am: `ተራ ቁጥር ${n}፣ እባክዎ ወደ ዶክተር ${c.doctor} ይግቡ።` };
  return { en: `Number ${n}. Please come in.`, am: `ተራ ቁጥር ${n}፣ እባክዎ ይግቡ።` };
}

// The on/off choice lives in this browser only: each TV decides for itself.
const listeners = new Set<() => void>();
function readPref() {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
}
function writePref(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  memoryPref = on;
  listeners.forEach((l) => l());
}
let memoryPref: boolean | null = null;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A two-note "ding-dong", made here so there is no sound file to ship or cache. */
function chime(ctx: AudioContext) {
  const start = ctx.currentTime + 0.05;
  [659.25, 523.25].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.5;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.3);
  });
  return new Promise<void>((done) => setTimeout(done, 1600));
}

/** Prefer a voice installed on the device: clinics often run without internet. */
function pickVoices() {
  const all = window.speechSynthesis.getVoices();
  const score = (v: SpeechSynthesisVoice) => (v.localService ? 2 : 0) + (/^en[-_](US|GB)/i.test(v.lang) ? 1 : 0);
  const en = all.filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a))[0];
  const am = all.find((v) => /^am/i.test(v.lang));
  return { en, am };
}

type Said = "ok" | "blocked";
function say(text: string, voice: SpeechSynthesisVoice | undefined, lang: string) {
  return new Promise<Said>((done) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? lang;
    u.rate = 0.85; // a little slower: a noisy room, many listeners, some hard of hearing
    // Some engines never fire "end"; never let one stuck line hold up the next call.
    const timer = setTimeout(() => done("ok"), 10_000);
    u.onend = () => {
      clearTimeout(timer);
      done("ok");
    };
    u.onerror = (e) => {
      clearTimeout(timer);
      done(e.error === "not-allowed" ? "blocked" : "ok");
    };
    window.speechSynthesis.speak(u);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Amharic first: most patients understand it; English follows. */
const ORDER: VoiceLang[] = ["am", "en"];

export function Announcer({ calls, voice }: { calls: Call[]; voice: string | null }) {
  const on = useSyncExternalStore(subscribe, () => memoryPref ?? readPref(), () => true);
  const [blocked, setBlocked] = useState(false);
  const [canSound, setCanSound] = useState(false);
  const ctx = useRef<AudioContext | null>(null);
  const clips = useRef(new Map<string, AudioBuffer>());
  const seen = useRef<Set<string> | null>(null);
  const pending = useRef<Call[]>([]);
  const busy = useRef(false);
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  }, [on]);

  const audio = useCallback(() => {
    if (!ctx.current && typeof AudioContext !== "undefined") ctx.current = new AudioContext();
    return ctx.current;
  }, []);

  // The recorded voice: fetched when the screen starts and again only when HMIS changes it.
  useEffect(() => {
    if (!voice) {
      clips.current = new Map();
      return;
    }
    let live = true;
    void (async () => {
      const a = audio();
      const res = await fetch(`/display/voice?v=${encodeURIComponent(voice)}`).catch(() => null);
      if (!a || !res?.ok || !live) return; // keeps the voice it had; the device's voice fills any gap
      const decoded = await decodePack(a, (await res.json()) as VoicePack);
      if (live) clips.current = decoded;
    })();
    return () => {
      live = false;
    };
  }, [voice, audio]);

  /** One call, in each language: the recorded voice where every word of it is recorded. */
  const announce = useCallback(async (a: AudioContext | null, c: Call, times: number): Promise<"ok" | "blocked"> => {
    const speech = "speechSynthesis" in window;
    if (speech) window.speechSynthesis.cancel(); // clears an engine stuck from a long idle
    const voices = speech ? pickVoices() : { en: undefined, am: undefined };
    const lines = callLines(c);
    for (let i = 0; i < times; i++) {
      for (const lang of ORDER) {
        const keys = callKeys(lang, c);
        if (a && canSay(clips.current, lang, keys)) await playClips(a, clips.current, lang, keys);
        else if (speech && lang === "en") {
          if ((await say(lines.en, voices.en, "en-US")) === "blocked") return "blocked";
        } else if (speech && voices.am) await say(lines.am, voices.am, "am-ET");
        await sleep(350);
      }
      if (i < times - 1) await sleep(500);
    }
    return "ok";
  }, []);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (pending.current.length && onRef.current) {
        const c = pending.current[0];
        const a = audio();
        if (a?.state === "suspended") await a.resume().catch(() => {});
        if (a && a.state !== "running") {
          setBlocked(true); // keep the call; it is said once someone taps the screen
          return;
        }
        if (a) await chime(a);
        if ((await announce(a, c, 2)) === "blocked") {
          setBlocked(true);
          return;
        }
        pending.current.shift();
        await sleep(800);
      }
    } finally {
      busy.current = false;
    }
  }, [audio, announce]);

  // Find out once whether this TV may play sound yet, and whether it can speak at all.
  useEffect(() => {
    let live = true;
    const speech = "speechSynthesis" in window;
    if (speech) window.speechSynthesis.getVoices(); // starts loading the voice list
    const a = audio();
    void (async () => {
      if (a?.state === "suspended") await Promise.race([a.resume().catch(() => {}), sleep(400)]);
      if (!live) return;
      setCanSound(speech || !!a);
      setBlocked(!!a && a.state !== "running");
    })();
    return () => {
      live = false;
    };
  }, [audio]);

  // New calls since the last refresh. Whoever was already called when the screen came on is not
  // said again: a TV switched on mid-morning must not read out the whole room.
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(calls.map((c) => c.id));
      return;
    }
    const fresh = calls.filter((c) => !seen.current!.has(c.id));
    fresh.forEach((c) => seen.current!.add(c.id));
    if (!fresh.length || !onRef.current) return;
    // The board lists the latest call first; say them in the order they were called.
    pending.current.push(...fresh.reverse());
    pending.current = pending.current.slice(-3); // after a long silence, only the latest few
    void run();
  }, [calls, run]);

  // A tap anywhere unlocks sound (the browser counts it as permission to play).
  const unlock = useCallback(async () => {
    const a = audio();
    await a?.resume().catch(() => {});
    if (a && a.state !== "running") return;
    setBlocked(false);
    void run();
  }, [audio, run]);

  // A TV is often worked with a remote or a mouse, so any tap or key on the screen will do.
  useEffect(() => {
    if (!on || !blocked) return;
    const go = () => void unlock();
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", go);
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, [on, blocked, unlock]);

  // Setting the TV up: one sample call, exactly as patients will hear it.
  const test = useCallback(async () => {
    await unlock();
    const a = audio();
    if (a?.state === "running") await chime(a);
    await announce(a?.state === "running" ? a : null, { id: "test", queueNumber: 1, doctor: null, room: "Room 1" }, 1);
  }, [audio, unlock, announce]);

  if (!canSound) return null; // a TV browser with neither speech nor audio: the screen still shows the call

  return (
    <>
      {on && blocked && (
        <button
          type="button"
          onClick={unlock}
          className="fixed inset-x-0 bottom-8 z-50 mx-auto flex w-fit items-center gap-4 rounded-2xl bg-white px-8 py-5 text-left text-slate-900 shadow-overlay"
        >
          <Volume2 aria-hidden className="size-10 shrink-0 text-brand-700" />
          <span>
            <span className="block text-2xl font-semibold">Tap to turn on voice calls</span>
            <span className="block text-lg text-slate-600">የድምፅ ጥሪ ለማብራት ይንኩ</span>
          </span>
        </button>
      )}
      <div className="fixed right-4 bottom-4 z-50 flex items-center gap-1 rounded-full bg-slate-900/90 p-1 text-sm text-slate-400 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => {
            writePref(!on);
            if (on) {
              pending.current = [];
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
            } else void unlock();
          }}
          aria-pressed={on}
          className="flex items-center gap-2 rounded-full px-3 py-1.5 hover:bg-white/10"
        >
          {on ? <Volume2 aria-hidden className="size-4" /> : <VolumeX aria-hidden className="size-4" />}
          {on ? "Voice calls on" : "Voice calls off"}
        </button>
        {on && (
          <button type="button" onClick={test} className="rounded-full px-3 py-1.5 hover:bg-white/10">
            Test
          </button>
        )}
      </div>
    </>
  );
}

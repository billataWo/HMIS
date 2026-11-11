/**
 * The recorded waiting-room voice: the words HMIS records once, how the TV joins them into a call,
 * and how a recording is cleaned up before it is kept. Used by the TV and the platform console.
 *
 * A call is "ተራ ቁጥር አስራ ሁለት፣ እባክዎ ወደ ክፍል ሁለት ይግቡ" then "Number twelve. Please go to room two."
 * Numbers up to 999 are joined from the words below, as people say them.
 */

export type VoiceLang = "am" | "en";
export const VOICE_LANGS: { lang: VoiceLang; label: string }[] = [
  { lang: "am", label: "አማርኛ · Amharic" },
  { lang: "en", label: "English" },
];

type Word = { key: string; group: "phrase" | "number"; label: string; am: string; en: string | null };

const AM_UNITS = ["", "አንድ", "ሁለት", "ሶስት", "አራት", "አምስት", "ስድስት", "ሰባት", "ስምንት", "ዘጠኝ"];
const EN_UNITS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EN_TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const AM_TENS = ["", "", "ሃያ", "ሰላሳ", "አርባ", "ሃምሳ", "ስልሳ", "ሰባ", "ሰማንያ", "ዘጠና"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Every clip, with what to say for it in each language (null: that language has no such clip). */
export const VOICE_WORDS: Word[] = [
  { key: "number", group: "phrase", label: "Number", am: "ተራ ቁጥር", en: "Number" },
  { key: "go_to", group: "phrase", label: "Please go to", am: "እባክዎ ወደ", en: "Please go to" },
  { key: "room", group: "phrase", label: "room", am: "ክፍል", en: "room" },
  // Amharic puts the verb last: "እባክዎ ወደ ክፍል ሁለት ይግቡ".
  { key: "enter", group: "phrase", label: "(go) in", am: "ይግቡ", en: null },
  { key: "come_in", group: "phrase", label: "Please come in", am: "እባክዎ ይግቡ", en: "Please come in" },
  ...Array.from({ length: 19 }, (_, i) => {
    const n = i + 1;
    return {
      key: `n${n}`,
      group: "number" as const,
      label: String(n),
      am: n < 10 ? AM_UNITS[n] : n === 10 ? "አስር" : `አስራ ${AM_UNITS[n - 10]}`,
      en: n < 10 ? EN_UNITS[n] : EN_TEENS[n - 10],
    };
  }),
  ...[2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ key: `n${t * 10}`, group: "number" as const, label: String(t * 10), am: AM_TENS[t], en: EN_TENS[t] })),
  { key: "hundred", group: "number", label: "100", am: "መቶ", en: "hundred" },
];

export const wordsFor = (lang: VoiceLang) => VOICE_WORDS.filter((w) => (lang === "am" ? true : w.en !== null));
export const sayFor = (w: Word, lang: VoiceLang) => (lang === "am" ? w.am : (w.en ?? ""));

/** The clips for a number, as people say it: 112 is "መቶ አስራ ሁለት" and "one hundred twelve". */
export function numberKeys(n: number, lang: VoiceLang): string[] | null {
  if (!Number.isInteger(n) || n < 1 || n > 999) return null;
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) {
    if (!(lang === "am" && h === 1)) out.push(`n${h}`); // Amharic: "መቶ", not "አንድ መቶ"
    out.push("hundred");
  }
  if (r) {
    if (r < 20) out.push(`n${r}`);
    else {
      out.push(`n${r - (r % 10)}`);
      if (r % 10) out.push(`n${r % 10}`);
    }
  }
  return out;
}

/** "Room 2", "room 2", "ክፍል 2" or just "2" can be said with the recorded words; other names cannot. */
export function roomNumber(room: string | null | undefined): number | null {
  const m = /^(?:room|rm\.?|ክፍል)?\s*(?:no\.?|#)?\s*(\d{1,3})$/i.exec((room ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** "," is a short pause. */
export const PAUSE = ",";

/**
 * The clips for one call in one language. A room that is not "Room <number>" (say "Dental") is not
 * named: the call ends "please come in", and the screen shows the room.
 */
export function callKeys(lang: VoiceLang, call: { queueNumber: number; room: string | null }): string[] | null {
  const num = numberKeys(call.queueNumber, lang);
  if (!num) return null;
  const rn = roomNumber(call.room);
  const roomKeys = rn ? numberKeys(rn, lang) : null;
  const tail = roomKeys ? ["go_to", "room", ...roomKeys, ...(lang === "am" ? ["enter"] : [])] : ["come_in"];
  return ["number", ...num, PAUSE, ...tail];
}

// ─── Audio ──────────────────────────────────────────────────────────────────────────────────────

const RATE = 22050; // plenty for speech, and a word stays a few tens of kilobytes
export const MAX_CLIP_SECONDS = 4;

/**
 * A recording or an uploaded file, made ready to keep: one channel, silence before and after cut
 * off, every clip brought to the same loudness, a few milliseconds of fade so words join without a
 * click, saved as WAV (which every TV browser can play).
 */
export async function prepareClip(input: ArrayBuffer): Promise<{ wav: ArrayBuffer; seconds: number }> {
  const probe = new OfflineAudioContext(1, 1, RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(input.slice(0));
  } catch {
    throw new Error("This is not an audio file the browser can read.");
  }
  if (decoded.duration > 30) throw new Error("That recording is too long: one word or phrase, a few seconds at most.");
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);

  let peak = 0;
  for (const s of mono) peak = Math.max(peak, Math.abs(s));
  if (peak < 0.02) throw new Error("Nothing was heard. Check the microphone and speak a little louder.");
  const threshold = Math.max(0.015, peak * 0.06);
  let first = 0;
  while (first < mono.length && Math.abs(mono[first]) < threshold) first++;
  let last = mono.length - 1;
  while (last > first && Math.abs(mono[last]) < threshold) last--;
  const start = Math.max(0, first - Math.round(0.04 * RATE));
  const end = Math.min(mono.length, last + Math.round(0.12 * RATE));
  const seconds = (end - start) / RATE;
  if (seconds > MAX_CLIP_SECONDS) throw new Error(`That is ${seconds.toFixed(1)} seconds: say just the word or phrase (at most ${MAX_CLIP_SECONDS} seconds).`);

  const gain = Math.min(8, 0.9 / peak);
  const fade = Math.round(0.008 * RATE);
  const out = new Float32Array(end - start);
  for (let i = 0; i < out.length; i++) {
    const edge = Math.min(1, i / fade, (out.length - 1 - i) / fade);
    out[i] = mono[start + i] * gain * edge;
  }
  return { wav: encodeWav(out, RATE), seconds };
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return buf;
}

export function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export type PackClip = { lang: VoiceLang; key: string; mime: string; data: string; updatedAt?: string };
export type VoicePack = { format: "hmis-voice-1"; version: string | null; clips: PackClip[] };

/** Every clip of a pack, ready to play: "am/n12" → audio. A clip that will not decode is left out. */
export async function decodePack(ctx: BaseAudioContext, pack: VoicePack) {
  const out = new Map<string, AudioBuffer>();
  await Promise.all(
    pack.clips.map(async (c) => {
      try {
        out.set(`${c.lang}/${c.key}`, await ctx.decodeAudioData(fromBase64(c.data)));
      } catch {
        // Left out: the TV says that part with its own voice.
      }
    }),
  );
  return out;
}

/** Whether every clip of this call is recorded. */
export const canSay = (clips: Map<string, AudioBuffer>, lang: VoiceLang, keys: string[] | null): keys is string[] =>
  !!keys && keys.every((k) => k === PAUSE || clips.has(`${lang}/${k}`));

/** Plays the clips one after another, words close together, a breath at each pause. */
export async function playClips(ctx: AudioContext, clips: Map<string, AudioBuffer>, lang: VoiceLang, keys: string[]) {
  let t = ctx.currentTime + 0.05;
  for (const k of keys) {
    if (k === PAUSE) {
      t += 0.3;
      continue;
    }
    const buf = clips.get(`${lang}/${k}`);
    if (!buf) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(t);
    t += buf.duration + 0.04;
  }
  await new Promise((r) => setTimeout(r, Math.max(0, (t - ctx.currentTime) * 1000)));
}

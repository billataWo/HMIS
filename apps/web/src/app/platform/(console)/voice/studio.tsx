"use client";

import { Check, Circle, Download, Mic, Play, RotateCcw, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Notice, buttonClass, ghostButtonClass, inputClass, pillClass, secondaryButtonClass } from "@/components/ui";
import {
  callKeys,
  decodePack,
  fromBase64,
  MAX_CLIP_SECONDS,
  PAUSE,
  playClips,
  prepareClip,
  sayFor,
  toBase64,
  VOICE_LANGS,
  VOICE_WORDS,
  type VoiceLang,
  type VoicePack,
  wordsFor,
} from "@/lib/voice";
import { removeVoiceClip, saveVoiceClip } from "../../actions";

type Take = { wav: ArrayBuffer; seconds: number; buffer: AudioBuffer };
const id = (lang: VoiceLang, key: string) => `${lang}/${key}`;

/**
 * The voice studio: HMIS records each word once, in Amharic and in English, and every clinic's
 * waiting-room TVs call patients with it. A take is cleaned up (silence cut, loudness evened out)
 * before it is played back, so what you hear is what the TVs will play.
 */
export function VoiceStudio({ canEdit }: { canEdit: boolean }) {
  const [raw, setRaw] = useState<Map<string, string> | null>(null); // "am/n12" → base64 WAV
  const [loadError, setLoadError] = useState<string | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const [lang, setLang] = useState<VoiceLang>("am");
  const [key, setKey] = useState("number");
  const [take, setTake] = useState<Take | null>(null);
  const [mode, setMode] = useState<"idle" | "recording" | "working">("idle");
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState<{ tone: "info" | "danger" | "success" | "warning"; text: string } | null>(null);
  const [previewNumber, setPreviewNumber] = useState("12");
  const [previewRoom, setPreviewRoom] = useState("Room 2");
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; stopMeter: () => void } | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const ctx = () => (ctxRef.current ??= new AudioContext());
  const decoder = () => new OfflineAudioContext(1, 1, 22050);

  // The voice as it is now.
  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch("/platform/voice/pack").catch(() => null);
      if (!live) return;
      if (!res?.ok) {
        setLoadError("The recorded voice could not be loaded. Reload the page to try again.");
        return;
      }
      const pack = (await res.json()) as VoicePack;
      buffers.current = await decodePack(decoder(), pack);
      if (!live) return;
      const map = new Map(pack.clips.map((c) => [id(c.lang, c.key), c.data]));
      setRaw(map);
      const firstMissing = wordsFor("am").find((w) => !map.has(id("am", w.key)));
      if (firstMissing) setKey(firstMissing.key);
    })();
    return () => {
      live = false;
    };
  }, []);

  const words = useMemo(() => wordsFor(lang), [lang]);
  const word = VOICE_WORDS.find((w) => w.key === key) ?? words[0];
  const has = (l: VoiceLang, k: string) => !!raw?.has(id(l, k));
  const count = (l: VoiceLang) => wordsFor(l).filter((w) => has(l, w.key)).length;

  const play = async (buf: AudioBuffer | undefined) => {
    if (!buf) return;
    const a = ctx();
    await a.resume();
    const src = a.createBufferSource();
    src.buffer = buf;
    src.connect(a.destination);
    src.start();
  };

  const takeFrom = async (input: ArrayBuffer) => {
    setMode("working");
    try {
      const { wav, seconds } = await prepareClip(input);
      const buffer = await decoder().decodeAudioData(wav.slice(0));
      setTake({ wav, seconds, buffer });
      setMessage(null);
      void play(buffer);
    } catch (e) {
      setTake(null);
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setMode("idle");
    }
  };

  const startRecording = async () => {
    setMessage(null);
    setTake(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setMessage({ tone: "danger", text: "The microphone is not available. Allow it for this site (the icon in the address bar) and check one is plugged in." });
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); // the microphone light goes off between takes
      await takeFrom(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
    };
    // A level meter, so you can see the microphone hears you.
    const a = ctx();
    await a.resume();
    const analyser = a.createAnalyser();
    analyser.fftSize = 512;
    a.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const s of data) peak = Math.max(peak, Math.abs(s));
      setLevel(peak);
      frame = requestAnimationFrame(tick);
    };
    tick();
    recorder.current = { rec, stream, stopMeter: () => cancelAnimationFrame(frame) };
    rec.start();
    setMode("recording");
    // Never record on and on by mistake.
    setTimeout(() => recorder.current?.rec === rec && rec.state === "recording" && stopRecording(), (MAX_CLIP_SECONDS + 4) * 1000);
  };

  const stopRecording = () => {
    const r = recorder.current;
    if (!r) return;
    recorder.current = null;
    r.stopMeter();
    setLevel(0);
    setMode("working");
    r.rec.stop();
  };

  const nextMissing = (after: string, saved: Map<string, string>) => {
    const i = words.findIndex((w) => w.key === after);
    const rest = [...words.slice(i + 1), ...words.slice(0, i + 1)];
    return rest.find((w) => !saved.has(id(lang, w.key)))?.key ?? after;
  };

  const save = async () => {
    if (!take || !raw) return;
    setMode("working");
    const data = toBase64(take.wav);
    const result = await saveVoiceClip(lang, word.key, data);
    setMode("idle");
    if (result.error) {
      setMessage({ tone: "danger", text: result.error });
      return;
    }
    buffers.current.set(id(lang, word.key), take.buffer);
    const map = new Map(raw).set(id(lang, word.key), data);
    setRaw(map);
    setTake(null);
    setMessage({ tone: "success", text: `Saved "${sayFor(word, lang)}".` });
    setKey(nextMissing(word.key, map));
  };

  const remove = async () => {
    if (!raw || !window.confirm(`Remove the recording of "${sayFor(word, lang)}"? The TVs will use the device's own voice for calls that need it.`)) return;
    const result = await removeVoiceClip(lang, word.key);
    if (result.error) return setMessage({ tone: "danger", text: result.error });
    buffers.current.delete(id(lang, word.key));
    const map = new Map(raw);
    map.delete(id(lang, word.key));
    setRaw(map);
    setMessage({ tone: "info", text: `Removed "${sayFor(word, lang)}".` });
  };

  // Many files at once, named by word: am-n12.mp3, en-number.wav …
  const uploadMany = async (files: FileList) => {
    if (!raw) return;
    setMode("working");
    const map = new Map(raw);
    const done: string[] = [];
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      const m = /^(am|en)[-_ ]([a-z0-9_]+)\.[a-z0-9]+$/i.exec(f.name);
      const w = m && VOICE_WORDS.find((x) => x.key === m[2].toLowerCase());
      const l = m?.[1].toLowerCase() as VoiceLang | undefined;
      if (!w || !l || (l === "en" && w.en === null)) {
        problems.push(`${f.name}: name it like am-n12.mp3 or en-number.wav`);
        continue;
      }
      try {
        const { wav } = await prepareClip(await f.arrayBuffer());
        const data = toBase64(wav);
        const r = await saveVoiceClip(l, w.key, data);
        if (r.error) throw new Error(r.error);
        buffers.current.set(id(l, w.key), await decoder().decodeAudioData(fromBase64(data)));
        map.set(id(l, w.key), data);
        done.push(f.name);
      } catch (e) {
        problems.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setRaw(map);
    setMode("idle");
    setMessage({
      tone: !problems.length ? "success" : done.length ? "warning" : "danger",
      text: [done.length ? `Saved ${done.length} file${done.length === 1 ? "" : "s"}.` : "", ...problems].filter(Boolean).join(" "),
    });
  };

  // Space records and stops, Enter keeps the take: recording sixty words goes quickly.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, button, a")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (mode === "recording") stopRecording();
        else if (mode === "idle") void startRecording();
      } else if (e.key === "Enter" && take && mode === "idle") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const preview = useMemo(() => {
    const n = Number(previewNumber);
    return VOICE_LANGS.map(({ lang: l }) => {
      const keys = callKeys(l, { queueNumber: n, room: previewRoom || null });
      const missing = keys ? keys.filter((k) => k !== PAUSE && !raw?.has(id(l, k))) : [];
      return { lang: l, keys, missing };
    });
  }, [previewNumber, previewRoom, raw]);

  const playPreview = async () => {
    const a = ctx();
    await a.resume();
    for (const p of preview) {
      if (!p.keys) continue;
      await playClips(a, buffers.current, p.lang, p.keys);
      await new Promise((r) => setTimeout(r, 350));
    }
  };

  if (loadError) return <Notice tone="danger">{loadError}</Notice>;
  if (!raw) return <p className="text-sm text-slate-500">Loading the voice…</p>;

  const recorded = has(lang, word.key);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-6 lg:sticky lg:top-6">
        <Card title="Progress">
          <div className="space-y-3">
            {VOICE_LANGS.map(({ lang: l, label }) => {
              const total = wordsFor(l).length;
              const done = count(l);
              return (
                <div key={l}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-slate-900 dark:text-white">{label}</span>
                    <span className="text-slate-500 tabular-nums">
                      {done} of {total}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={done} aria-valuemax={total} aria-label={`${label} recorded`}>
                    <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-slate-500">Until a language is complete, the TVs say it with the device&apos;s own voice (English always; Amharic only where the device has one).</p>
          </div>
        </Card>

        {canEdit && (
          <Card
            title="Record"
            description="Speak as you would to a waiting room: clear and calm, the same distance from the microphone each time."
            actions={
              <div className="flex gap-1" role="group" aria-label="Language">
                {VOICE_LANGS.map(({ lang: l, label }) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    className={pillClass(lang === l)}
                    onClick={() => {
                      setLang(l);
                      setTake(null);
                      if (l === "en" && key === "enter") setKey("number");
                    }}
                  >
                    {label.split(" · ")[0]}
                  </button>
                ))}
              </div>
            }
          >
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {word.group === "number" ? `Number ${word.label}` : word.label} · {lang === "am" ? "Amharic" : "English"}
            </p>
            <p className="mt-1 text-4xl font-semibold tracking-tight text-slate-900 dark:text-white" lang={lang}>
              {sayFor(word, lang)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {recorded ? "Recorded. Record again to replace it." : "Not recorded yet."} Say only this, then stop.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {mode === "recording" ? (
                <button type="button" onClick={stopRecording} className={`${buttonClass} bg-red-600 hover:bg-red-700 dark:bg-red-600`}>
                  <Square aria-hidden className="size-4" /> Stop
                </button>
              ) : (
                <button type="button" onClick={() => void startRecording()} disabled={mode === "working"} className={buttonClass}>
                  <Mic aria-hidden className="size-4" /> {take ? "Record again" : "Record"}
                </button>
              )}
              {take && mode === "idle" && (
                <>
                  <button type="button" onClick={() => void play(take.buffer)} className={secondaryButtonClass}>
                    <Play aria-hidden className="size-4" /> Play take
                  </button>
                  <button type="button" onClick={() => void save()} className={buttonClass}>
                    <Check aria-hidden className="size-4" /> Save &amp; next
                  </button>
                  <button type="button" onClick={() => setTake(null)} className={ghostButtonClass}>
                    <RotateCcw aria-hidden className="size-4" /> Discard
                  </button>
                </>
              )}
              {!take && recorded && mode === "idle" && (
                <>
                  <button type="button" onClick={() => void play(buffers.current.get(id(lang, word.key)))} className={secondaryButtonClass}>
                    <Play aria-hidden className="size-4" /> Play saved
                  </button>
                  <button type="button" onClick={() => void remove()} className={ghostButtonClass}>
                    <Trash2 aria-hidden className="size-4" /> Remove
                  </button>
                </>
              )}
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
              <div className={`h-full rounded-full ${level > 0.9 ? "bg-red-500" : "bg-emerald-500"} transition-[width] duration-75`} style={{ width: `${Math.min(100, level * 110)}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500" aria-live="polite">
              {mode === "recording" ? "Recording… speak now, then Stop (or Space)." : mode === "working" ? "Working…" : take ? `Take: ${take.seconds.toFixed(1)} s, silence trimmed. Enter saves it.` : "Space starts and stops recording."}
            </p>

            {message && (
              <div className="mt-4">
                <Notice tone={message.tone}>{message.text}</Notice>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
              <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-brand-700 dark:text-brand-400">
                <Upload aria-hidden className="size-4" /> Upload a file for this word
                <input type="file" accept="audio/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void e.target.files[0].arrayBuffer().then(takeFrom) && (e.target.value = "")} />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-brand-700 dark:text-brand-400">
                <Upload aria-hidden className="size-4" /> Upload many, named by word
                <input type="file" accept="audio/*" multiple className="sr-only" onChange={(e) => e.target.files?.length && void uploadMany(e.target.files).then(() => (e.target.value = ""))} />
              </label>
              <p className="w-full text-xs text-slate-500">Name files with the language and word: am-number.mp3, am-n12.wav, en-go_to.m4a … (the word names are under each word on the right).</p>
            </div>
          </Card>
        )}

        <Card title="Try a call" description="Exactly as the TVs will say it: Amharic, then English.">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Number</span>
              <input className={`${inputClass} w-24`} inputMode="numeric" value={previewNumber} onChange={(e) => setPreviewNumber(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Room</span>
              <input className={`${inputClass} w-36`} value={previewRoom} maxLength={40} onChange={(e) => setPreviewRoom(e.target.value)} />
            </label>
            <button type="button" onClick={() => void playPreview()} className={secondaryButtonClass} disabled={!preview.some((p) => p.keys && !p.missing.length)}>
              <Play aria-hidden className="size-4" /> Play
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {preview.map((p) => (
              <li key={p.lang} className="text-slate-600 dark:text-slate-300">
                <span className="font-medium">{p.lang === "am" ? "Amharic" : "English"}:</span>{" "}
                {!p.keys
                  ? "numbers 1 to 999 only"
                  : p.missing.length
                    ? `missing ${p.missing.map((k) => `“${sayFor(VOICE_WORDS.find((w) => w.key === k)!, p.lang)}”`).join(", ")} (the device's voice says this one)`
                    : p.keys.filter((k) => k !== PAUSE).map((k) => sayFor(VOICE_WORDS.find((w) => w.key === k)!, p.lang)).join(" ")}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">A room is said when it is named &ldquo;Room 2&rdquo; (or just &ldquo;2&rdquo;); any other name is shown on the TV, and the call ends &ldquo;please come in&rdquo;.</p>
        </Card>

        <Card title="Clinic servers">
          <p className="text-sm text-slate-600 dark:text-slate-300">Clinics on the cloud use this voice at once. A clinic on its own server needs the file once (and again after you change the voice):</p>
          <a href="/platform/voice/pack?download=1" className={`${secondaryButtonClass} mt-3`} download>
            <Download aria-hidden className="size-4" /> Download the voice
          </a>
          <p className="mt-3 text-xs text-slate-500">
            On that server: <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">deploy/hmis voice install hmis-voice.json</code>
          </p>
        </Card>
      </div>

      <Card title={canEdit ? "Words" : "The recorded voice"} description={canEdit ? "Pick a word to record it. Recorded words can be played." : "Only owners record the voice."}>
        {!canEdit && (
          <div className="mb-4 flex gap-1" role="group" aria-label="Language">
            {VOICE_LANGS.map(({ lang: l, label }) => (
              <button key={l} type="button" aria-pressed={lang === l} className={pillClass(lang === l)} onClick={() => setLang(l)}>
                {label.split(" · ")[0]}
              </button>
            ))}
          </div>
        )}
        {(["phrase", "number"] as const).map((group) => (
          <div key={group} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{group === "phrase" ? "Phrases" : "Numbers"}</h3>
            <ul className={`grid gap-2 ${group === "phrase" ? "sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3"}`}>
              {words
                .filter((w) => w.group === group)
                .map((w) => {
                  const done = has(lang, w.key);
                  const current = canEdit && w.key === word.key;
                  return (
                    <li key={w.key} className={`flex items-center gap-1 rounded-lg border ${current ? "border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-950" : "border-slate-200 dark:border-slate-800"}`}>
                      <button
                        type="button"
                        disabled={!canEdit}
                        aria-current={current ? "true" : undefined}
                        onClick={() => {
                          setKey(w.key);
                          setTake(null);
                          setMessage(null);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
                      >
                        {done ? (
                          <Check aria-label="recorded" className="size-4 shrink-0 text-emerald-600" />
                        ) : (
                          <Circle aria-label="not recorded" className="size-4 shrink-0 text-slate-300 dark:text-slate-600" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900 dark:text-white" lang={lang}>
                            {sayFor(w, lang)}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {w.label} · {lang}-{w.key}
                          </span>
                        </span>
                      </button>
                      {done && (
                        <button type="button" onClick={() => void play(buffers.current.get(id(lang, w.key)))} className="mr-1 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white" aria-label={`Play ${sayFor(w, lang)}`}>
                          <Play aria-hidden className="size-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
}

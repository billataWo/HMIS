import type { Db } from '@hmis/db';

/**
 * The waiting-room voice: short recordings, one per word or phrase, per language, that the TV joins
 * into "Number twelve. Please go to room two." The same pack serves every clinic.
 *
 *   number           "ተራ ቁጥር" / "Number"
 *   n1 … n19         the numbers one to nineteen
 *   n20 … n90        twenty, thirty … ninety
 *   hundred          "መቶ" / "hundred"
 *   go_to            "እባክዎ ወደ" / "Please go to"
 *   room             "ክፍል" / "room"
 *   enter            "ይግቡ" (Amharic puts the verb last; English has no clip here)
 *   come_in          "እባክዎ ይግቡ" / "Please come in" (when there is no room to name)
 */
export const VOICE_LANGS = ['am', 'en'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];
export const VOICE_KEY = /^(number|n([1-9]|1[0-9]|[2-9]0)|hundred|go_to|room|enter|come_in)$/;

/** A few seconds of mono WAV at 22 kHz is under 200 kB; this leaves room for uploads as they are. */
export const VOICE_MAX_BYTES = 400_000;

/**
 * What the bytes really are, from their first bytes (never from the name or the type the browser
 * gave): only audio the TVs can play is kept.
 */
export function sniffAudio(b: Buffer): string | null {
  if (b.length < 12) return null;
  const ascii = (from: number, to: number) => b.subarray(from, to).toString('latin1');
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

/**
 * Changes whenever a clip is saved or removed. The board carries it, so a TV fetches the pack again
 * only when it changed. Read at most every 15 seconds: every TV asks every few seconds.
 */
let cached: { at: number; version: string | null } | null = null;
export async function voiceVersion(db: Db): Promise<string | null> {
  if (cached && Date.now() - cached.at < 15_000) return cached.version;
  const agg = await db.voiceClip.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  const version = agg._count._all ? `${agg._count._all}-${agg._max.updatedAt?.getTime() ?? 0}` : null;
  cached = { at: Date.now(), version };
  return version;
}
export function forgetVoiceVersion() {
  cached = null;
}

/** The whole pack, as the TVs and the console's preview use it (and as a file for clinic servers). */
export async function voicePack(db: Db) {
  const clips = await db.voiceClip.findMany({ orderBy: [{ lang: 'asc' }, { key: 'asc' }] });
  return {
    format: 'hmis-voice-1',
    version: await voiceVersion(db),
    clips: clips.map((c) => ({ lang: c.lang, key: c.key, mime: c.mime, data: Buffer.from(c.data).toString('base64'), updatedAt: c.updatedAt })),
  };
}

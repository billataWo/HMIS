import type { Frequency } from "@/lib/api";

/**
 * Directions in words a patient can follow, in English and Amharic, for medicine labels and the
 * medication history. The dose is shown as the doctor typed it.
 */
const FREQ: Record<Frequency, { en: string; am: string }> = {
  OD: { en: "once a day", am: "በቀን አንድ ጊዜ" },
  BID: { en: "twice a day", am: "በቀን ሁለት ጊዜ" },
  TID: { en: "3 times a day", am: "በቀን ሦስት ጊዜ" },
  QID: { en: "4 times a day", am: "በቀን አራት ጊዜ" },
  NOCTE: { en: "at night, before sleep", am: "ማታ ከመተኛት በፊት" },
  PRN: { en: "only when needed", am: "ሲያስፈልግ ብቻ" },
  STAT: { en: "once, now", am: "አሁን አንድ ጊዜ" },
};

export function directions(i: { dose: string; frequency: Frequency; durationDays: number | null }) {
  const f = FREQ[i.frequency] ?? { en: i.frequency, am: i.frequency };
  const days = i.durationDays && i.frequency !== "STAT" ? i.durationDays : null;
  return {
    en: `Take ${i.dose} ${f.en}${days ? ` for ${days} ${days === 1 ? "day" : "days"}` : ""}.`,
    am: `${i.dose} ${f.am}${days ? ` ለ${days} ${days === 1 ? "ቀን" : "ቀናት"}` : ""} ይውሰዱ።`,
  };
}

/** Short form for lists: "1 g TID × 3 d". */
export const shortDirections = (i: { dose: string; frequency: Frequency; durationDays: number | null }) =>
  `${i.dose} ${i.frequency}${i.durationDays ? ` × ${i.durationDays} d` : ""}`;

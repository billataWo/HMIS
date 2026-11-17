/**
 * What a lab test is done on, and its tube or container (the API's list, in lab/specimens.ts).
 * `short` fits on a tube label; `cap` is the tube cap colour shown as a dot.
 */
export const SPECIMENS: Record<string, { label: string; short: string; cap: string }> = {
  EDTA: { label: "Whole blood, EDTA (purple top)", short: "EDTA · purple", cap: "bg-purple-600" },
  SERUM: { label: "Serum (red or yellow top)", short: "Serum · red/yellow", cap: "bg-red-600" },
  FLUORIDE: { label: "Plasma, fluoride (grey top)", short: "Fluoride · grey", cap: "bg-slate-400" },
  CITRATE: { label: "Blood, citrate (light blue top)", short: "Citrate · light blue", cap: "bg-sky-400" },
  HEPARIN: { label: "Plasma, heparin (green top)", short: "Heparin · green", cap: "bg-green-600" },
  CAPILLARY: { label: "Capillary blood (finger prick)", short: "Finger prick", cap: "bg-rose-400" },
  URINE: { label: "Urine (clean-catch cup)", short: "Urine", cap: "bg-yellow-400" },
  STOOL: { label: "Stool (container)", short: "Stool", cap: "bg-amber-800" },
  SPUTUM: { label: "Sputum (container)", short: "Sputum", cap: "bg-lime-600" },
  SWAB: { label: "Swab", short: "Swab", cap: "bg-white ring-1 ring-slate-400" },
  CSF: { label: "Cerebrospinal fluid", short: "CSF", cap: "bg-cyan-200 ring-1 ring-slate-400" },
  OTHER: { label: "Other", short: "Other", cap: "bg-slate-300" },
};

/** In the screen's language when `t` is given (tube labels stay as printed). */
export const specimenLabel = (code: string | null | undefined, t?: (s: string) => string) => (code ? (t ? t(SPECIMENS[code]?.label ?? code) : (SPECIMENS[code]?.label ?? code)) : null);
export const specimenShort = (code: string | null | undefined, t?: (s: string) => string) => (code ? (t ? t(SPECIMENS[code]?.short ?? code) : (SPECIMENS[code]?.short ?? code)) : null);

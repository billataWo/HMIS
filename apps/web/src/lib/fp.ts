/** Family planning labels (the API's FP_METHODS, REMOVAL_REASONS and STOP_REASONS). */

export type FpMethodInfo = {
  label: string;
  sex: "FEMALE" | "MALE" | "ANY";
  kind: "SUPPLY" | "INJECTION" | "DEVICE" | "PERMANENT" | "OTHER";
  /** What the quantity counts, when one is given. */
  unit?: string;
  max?: number;
};

export const FP_METHODS: Record<string, FpMethodInfo> = {
  COC: { label: "Combined pills (COC)", sex: "FEMALE", kind: "SUPPLY", unit: "cycles", max: 13 },
  POP: { label: "Progestin-only pills (POP)", sex: "FEMALE", kind: "SUPPLY", unit: "cycles", max: 13 },
  DMPA_IM: { label: "Injectable, DMPA-IM (Depo)", sex: "FEMALE", kind: "INJECTION" },
  DMPA_SC: { label: "Injectable, DMPA-SC (Sayana Press)", sex: "FEMALE", kind: "INJECTION" },
  IMPLANT_3Y: { label: "Implant, 3 years (Implanon NXT)", sex: "FEMALE", kind: "DEVICE" },
  IMPLANT_5Y: { label: "Implant, 5 years (Jadelle)", sex: "FEMALE", kind: "DEVICE" },
  IUCD: { label: "IUCD (copper T)", sex: "FEMALE", kind: "DEVICE" },
  CONDOM_MALE: { label: "Male condoms", sex: "ANY", kind: "SUPPLY", unit: "pieces", max: 500 },
  CONDOM_FEMALE: { label: "Female condoms", sex: "FEMALE", kind: "SUPPLY", unit: "pieces", max: 200 },
  EC: { label: "Emergency contraception", sex: "FEMALE", kind: "OTHER", unit: "doses", max: 5 },
  TUBAL_LIGATION: { label: "Tubal ligation", sex: "FEMALE", kind: "PERMANENT" },
  VASECTOMY: { label: "Vasectomy", sex: "MALE", kind: "PERMANENT" },
  LAM: { label: "Lactational amenorrhoea (LAM)", sex: "FEMALE", kind: "OTHER" },
  SDM: { label: "Standard days method (cycle beads)", sex: "FEMALE", kind: "OTHER" },
};

export const FP_SERVICES: Record<string, string> = {
  START: "Started",
  RESUPPLY: "Resupplied",
  REMOVAL: "Taken out",
  STOP: "Stopped",
};

export const FP_REMOVAL_REASONS: Record<string, string> = {
  DUE: "Its time was up (replaced or not)",
  WANTS_PREGNANCY: "Wants to become pregnant",
  SIDE_EFFECTS: "Side effects",
  SWITCHING: "Switching to another method",
  OTHER: "Other",
};

export const FP_STOP_REASONS: Record<string, string> = {
  WANTS_PREGNANCY: "Wants to become pregnant",
  SIDE_EFFECTS: "Side effects",
  MENOPAUSE: "Menopause",
  LOST_TO_FOLLOW_UP: "Did not come back (lost to follow-up)",
  OTHER: "Other",
};

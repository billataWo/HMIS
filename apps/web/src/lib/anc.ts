/** Antenatal care wording for the screens; the keys match the API's. */
export const RISK_FACTORS: Record<string, string> = {
  PREVIOUS_CAESAREAN: "Previous caesarean section",
  PREVIOUS_STILLBIRTH: "Previous stillbirth or newborn death",
  PREVIOUS_PPH: "Previous heavy bleeding after birth",
  PREVIOUS_PREECLAMPSIA: "Previous pre-eclampsia or eclampsia",
  HYPERTENSION: "Chronic hypertension",
  DIABETES: "Diabetes",
  HIV: "HIV positive",
  MULTIPLE: "Twins or more",
  SHORT_STATURE: "Height under 150 cm",
};

export const DANGER_SIGNS: Record<string, string> = {
  BLEEDING: "Vaginal bleeding",
  HEADACHE: "Severe headache or blurred vision",
  CONVULSIONS: "Fits (convulsions)",
  ABDOMINAL_PAIN: "Severe abdominal pain",
  FEVER: "Fever",
  BREATHING: "Difficulty breathing",
  REDUCED_MOVEMENT: "Baby moving less or not at all",
  WATERS_BROKE: "Leaking fluid (waters broken)",
  SWELLING: "Swelling of the face or hands",
};

export const URINE_PROTEIN: Record<string, string> = { NEGATIVE: "Negative", TRACE: "Trace", PLUS1: "+", PLUS2: "++", PLUS3: "+++" };
export const PRESENTATION: Record<string, string> = { CEPHALIC: "Head down", BREECH: "Breech", TRANSVERSE: "Transverse" };
export const TEST_RESULT: Record<string, string> = { NEGATIVE: "Negative", POSITIVE: "Positive", NOT_DONE: "Not done" };
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const OUTCOMES: Record<string, string> = {
  DELIVERED: "Delivered here",
  DELIVERED_ELSEWHERE: "Delivered elsewhere",
  MISCARRIAGE: "Miscarriage",
  ABORTION: "Abortion",
  STILLBIRTH: "Stillbirth",
  TRANSFERRED: "Transferred to another facility",
  LOST_TO_FOLLOW_UP: "Lost to follow-up",
};

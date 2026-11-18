import type { BadgeTone } from "@/components/ui";
import type { DoseStatus } from "./api";
import type { T } from "./i18n";

/** The schedule's milestone ("Birth", "6 weeks", "9 months", "Women 15–49") in the screen's language. */
export function milestoneText(t: T, m: string) {
  const n = /^(\d+) (weeks|months)$/.exec(m);
  return n ? t(n[2] === "weeks" ? "{n} weeks" : "{n} months", { n: Number(n[1]) }) : t(m);
}

/** How each dose's state reads on the card. */
export const DOSE_STATUS: Record<DoseStatus, { label: string; tone: BadgeTone }> = {
  GIVEN: { label: "Given", tone: "success" },
  DUE: { label: "Due", tone: "warning" },
  OVERDUE: { label: "Late", tone: "danger" },
  UPCOMING: { label: "Upcoming", tone: "neutral" },
  MISSED: { label: "Window passed", tone: "neutral" },
};

/** What came of a call to a child who missed a vaccine. */
export const EPI_FOLLOW_UPS = [
  { value: "NO_ANSWER", label: "No answer" },
  { value: "WILL_COME", label: "Will come" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "VACCINATED_ELSEWHERE", label: "Vaccinated elsewhere" },
  { value: "MOVED_AWAY", label: "Moved away" },
] as const;

/** Injection sites offered when recording a dose. */
export const SITES = ["Left thigh", "Right thigh", "Left upper arm", "Right upper arm", "By mouth"];

/** What can follow a vaccine (AEFI): the API's AEFI_SIGNS. */
export const AEFI_SIGNS: Record<string, string> = {
  INJECTION_SITE: "Swelling, redness or abscess at the injection site",
  FEVER: "High fever (39 °C or more)",
  RASH: "Rash",
  CRYING: "Crying for 3 hours or more",
  SEIZURE: "Fits (convulsions)",
  HHE: "Floppy, pale and unresponsive",
  ANAPHYLAXIS: "Severe allergic reaction (anaphylaxis)",
  BCG_LYMPHADENITIS: "BCG: swollen lymph node",
  OTHER: "Other",
};

/** How an adverse event ended. */
export const AEFI_OUTCOMES: Record<string, string> = {
  RECOVERED: "Recovered",
  RECOVERING: "Recovering",
  NOT_RECOVERED: "Not recovered",
  DIED: "Died",
  UNKNOWN: "Not known yet",
};

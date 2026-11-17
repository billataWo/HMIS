import type { BadgeTone } from "@/components/ui";
import type { DoseStatus } from "./api";

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

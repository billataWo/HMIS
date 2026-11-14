import type { BadgeTone } from "@/components/ui";

/** What came of a reminder call before the day. */
export const REMINDER_OUTCOMES = [
  { value: "CONFIRMED", label: "Confirmed", tone: "success" },
  { value: "NO_ANSWER", label: "No answer", tone: "warning" },
  { value: "CANNOT_COME", label: "Can't come", tone: "danger" },
  { value: "WRONG_NUMBER", label: "Wrong number", tone: "neutral" },
] as const satisfies readonly { value: string; label: string; tone: BadgeTone }[];

/** What came of the call after a missed appointment. */
export const TRACE_OUTCOMES = [
  { value: "NO_ANSWER", label: "No answer", tone: "warning" },
  { value: "WILL_COME", label: "Will come", tone: "info" },
  { value: "REBOOKED", label: "Rebooked", tone: "success" },
  { value: "WRONG_NUMBER", label: "Wrong number", tone: "neutral" },
  { value: "DECLINED", label: "Won't come back", tone: "neutral" },
] as const satisfies readonly { value: string; label: string; tone: BadgeTone }[];

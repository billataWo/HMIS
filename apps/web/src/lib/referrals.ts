import type { BadgeTone } from "@/components/ui";
import type { ReferralStatus } from "./api";

/** Where a referral stands, worded for the list and the visit. */
export const REFERRAL_STATUS: Record<ReferralStatus, { label: string; tone: BadgeTone }> = {
  SENT: { label: "Sent", tone: "warning" },
  ARRIVED: { label: "Arrived, feedback awaited", tone: "info" },
  FEEDBACK_RECEIVED: { label: "Feedback received", tone: "success" },
  DID_NOT_GO: { label: "Did not go", tone: "neutral" },
};

export const URGENCY_LABEL: Record<string, string> = { ROUTINE: "Routine", URGENT: "Urgent", EMERGENCY: "Emergency" };

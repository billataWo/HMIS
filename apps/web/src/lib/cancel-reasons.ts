/** Why a visit is cancelled; "left without being seen" is counted on the dashboard. */
export const CANCEL_REASONS = [
  { value: "LEFT_WITHOUT_BEING_SEEN", label: "Left without being seen" },
  { value: "CANNOT_PAY", label: "Could not pay" },
  { value: "SENT_ELSEWHERE", label: "Sent to another facility" },
  { value: "CHECKED_IN_BY_MISTAKE", label: "Checked in by mistake" },
  { value: "OTHER", label: "Other reason" },
] as const;

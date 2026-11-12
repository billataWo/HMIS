import { ShieldAlert } from "lucide-react";
import { BADGE_TONES, badgeClass } from "@/components/ui";
import type { ControlledClass } from "@/lib/api";

export const CONTROLLED_LABEL: Record<ControlledClass, string> = { NARCOTIC: "Narcotic", PSYCHOTROPIC: "Psychotropic" };

/** Marks a narcotic or psychotropic wherever the drug appears: register, no counter sale. */
export function ControlledBadge({ c }: { c?: ControlledClass | null }) {
  if (!c) return null;
  return (
    <span className={`${badgeClass} ${BADGE_TONES.violet}`} title="Controlled drug: every unit is kept in the controlled-drug register">
      <ShieldAlert aria-hidden className="size-3" />
      {CONTROLLED_LABEL[c]}
    </span>
  );
}

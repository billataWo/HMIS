"use client";

import { ShieldAlert } from "lucide-react";
import { BADGE_TONES, badgeClass } from "@/components/ui";
import type { ControlledClass } from "@/lib/api";
import { CONTROLLED_LABEL } from "@/lib/controlled";
import { useT } from "./lang-provider";

/** Marks a narcotic or psychotropic wherever the drug appears: register, no counter sale. */
export function ControlledBadge({ c }: { c?: ControlledClass | null }) {
  const t = useT();
  if (!c) return null;
  return (
    <span className={`${badgeClass} ${BADGE_TONES.violet}`} title={t("Controlled drug: every unit is kept in the controlled-drug register")}>
      <ShieldAlert aria-hidden className="size-3" />
      {t(CONTROLLED_LABEL[c])}
    </span>
  );
}

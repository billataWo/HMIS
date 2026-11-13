"use client";

import { useState } from "react";
import type { CoverageOption } from "@/lib/api";
import { isPast } from "@/lib/format";
import { inputClass } from "./ui";

/** "Ethio Telecom · ET-5531 · 20% co-pay", or when it ended. */
function label(c: CoverageOption) {
  const ended = c.validUntil && isPast(c.validUntil);
  return [
    c.payer.name,
    c.memberId,
    Number(c.payer.coPayPercent) > 0 ? `${Number(c.payer.coPayPercent)}% co-pay` : "fully covered",
    ended && `ended ${c.validUntil!.slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Who pays for this visit: the patient, or one of their coverages (the first usable one is chosen;
 * an ended one is shown but can't be picked), with the authorization number when the payer wants
 * one. Posts `coverageId` and `authorizationNo`. Shows nothing for a patient with no coverage.
 */
export function CoverageChoice({ coverages, className = "" }: { coverages: CoverageOption[]; className?: string }) {
  const usable = coverages.filter((c) => !(c.validUntil && isPast(c.validUntil)));
  const [coverageId, setCoverageId] = useState(usable[0]?.id ?? "");
  const chosen = coverages.find((c) => c.id === coverageId);
  if (!coverages.length) return null;
  return (
    <>
      <select name="coverageId" value={coverageId} onChange={(e) => setCoverageId(e.target.value)} className={`${inputClass} ${className}`} aria-label="Who pays">
        <option value="">Patient pays</option>
        {coverages.map((c) => (
          <option key={c.id} value={c.id} disabled={!usable.includes(c)}>
            {label(c)}
          </option>
        ))}
      </select>
      {chosen?.payer.requiresAuthorization && (
        <input name="authorizationNo" required placeholder={`${chosen.payer.name} authorization no.`} aria-label="Authorization number" className={`${inputClass} ${className}`} />
      )}
    </>
  );
}

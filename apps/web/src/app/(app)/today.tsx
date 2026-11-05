"use client";

import { useEffect, useState } from "react";
import { formatDualDate } from "@/lib/format";

/** Today's date in both calendars, rendered in the browser so it uses the clinic's local date. */
export function Today() {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(formatDualDate(new Date().toISOString())), []);
  return <p className="text-sm text-zinc-500">{label}</p>;
}

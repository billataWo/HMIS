"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

/** Prints the page (the browser's own dialog: a printer, or "Save as PDF"). */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${buttonClass} gap-2 print:hidden`}>
      <Printer aria-hidden className="size-4" />
      {label}
    </button>
  );
}

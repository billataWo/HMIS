"use client";

import { Printer } from "lucide-react";
import { secondaryButtonClass } from "./ui";

/** Full-width on printable pages (receipts, reports); `inline` for a page header. */
export function PrintButton({ inline = false }: { inline?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={inline ? `${secondaryButtonClass} print:hidden` : "w-full rounded-md bg-brand-700 py-2 font-sans text-sm text-white print:hidden"}
    >
      {inline && <Printer aria-hidden />}
      Print
    </button>
  );
}

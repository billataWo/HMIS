"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="w-full rounded-md bg-teal-700 py-2 font-sans text-sm text-white print:hidden">
      Print
    </button>
  );
}

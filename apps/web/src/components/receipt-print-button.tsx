"use client";

import { useTransition } from "react";
import { recordReceiptPrint } from "@/app/actions";
import { useT } from "./lang-provider";

/**
 * Prints the receipt and records the print, so a later reprint of the same receipt says COPY.
 * (The page is not refreshed first: this print still shows what was on screen.)
 */
export function ReceiptPrintButton({ invoiceId }: { invoiceId: string }) {
  const [pending, start] = useTransition();
  const t = useT();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await recordReceiptPrint(invoiceId);
          window.print();
        })
      }
      className="w-full rounded-md bg-brand-700 py-2 font-sans text-sm text-white print:hidden"
    >
      {pending ? t("Printing…") : t("Print")}
    </button>
  );
}

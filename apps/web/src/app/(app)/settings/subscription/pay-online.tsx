"use client";

import { CreditCard, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useT } from "@/components/lang-provider";
import { Alert, buttonClass, secondaryButtonClass } from "@/components/ui";
import { payOnline } from "./actions";

/** Pay an invoice now with Chapa or telebirr: off to their payment page, then back here. */
export function PayOnline({ invoiceId, chapa, telebirr }: { invoiceId: string; chapa: boolean; telebirr: boolean }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const t = useT();
  const go = (provider: "CHAPA" | "TELEBIRR") =>
    start(async () => {
      setError(undefined);
      const result = await payOnline(invoiceId, provider);
      if (result.url) window.location.assign(result.url);
      else setError(result.error);
    });
  return (
    <div className="space-y-2">
      {error && <Alert>{t(error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        {telebirr && (
          <button type="button" disabled={pending} onClick={() => go("TELEBIRR")} className={buttonClass}>
            <Smartphone aria-hidden className="size-4" /> {t("Pay with telebirr")}
          </button>
        )}
        {chapa && (
          <button type="button" disabled={pending} onClick={() => go("CHAPA")} className={telebirr ? secondaryButtonClass : buttonClass}>
            <CreditCard aria-hidden className="size-4" /> {t("Pay with Chapa")}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">{chapa ? `${t("Chapa takes cards, telebirr, CBE Birr, M-Pesa and bank accounts.")} ` : ""}
        {t("The clinic works normally again as soon as the payment goes through.")}</p>
    </div>
  );
}

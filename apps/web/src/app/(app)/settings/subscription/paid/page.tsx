import { CircleCheck, Clock, CircleX } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageTitle } from "@/components/page-title";
import { buttonClass, Card, secondaryButtonClass, Skeleton } from "@/components/ui";
import { etb } from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { checkPayment } from "../actions";

const backLink = (t: T) => (
  <Link href="/settings/subscription" className={buttonClass}>
    {t("Back to the subscription")}
  </Link>
);

/**
 * Where Chapa and telebirr send the payer back to. HMIS asks the provider itself: what the address
 * bar says counts for nothing.
 */
async function Result({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const ref = (await searchParams).ref ?? "";
  const t = await getT();
  const back = backLink(t);
  const r = /^HMIS[0-9A-F]{6,40}$/.test(ref) ? await checkPayment(ref) : null;
  if (!r) {
    return (
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("This payment is not known here.")}</p>
        <div className="mt-4">{back}</div>
      </Card>
    );
  }
  const via = r.provider === "CHAPA" ? "Chapa" : "telebirr";
  if (r.status === "PAID") {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <CircleCheck aria-hidden className="size-8 shrink-0 text-emerald-600" />
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">{t("Payment received: thank you")}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {r.invoice && r.applied
                ? t(r.invoice.status === "PAID" ? "{amount} by {via} for invoice {number}, which is now paid." : "{amount} by {via} for invoice {number}.", {
                    amount: etb(r.amount, t),
                    via,
                    number: r.invoice.number,
                  })
                : t("{amount} by {via}.", { amount: etb(r.amount, t), via })}
              {!r.applied && ` ${t("HMIS will apply it to your account and contact you if anything is needed.")}`}
            </p>
            <div className="mt-4">{back}</div>
          </div>
        </div>
      </Card>
    );
  }
  if (r.status === "CREATED") {
    return (
      <Card>
        <AutoRefresh seconds={5} />
        <div className="flex items-start gap-3">
          <Clock aria-hidden className="size-8 shrink-0 text-amber-500" />
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">{t("Waiting for {via} to confirm the payment…", { via })}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {t("This page updates by itself. If you left the payment page without paying, nothing was charged: go back and choose a way to pay.")}
            </p>
            <div className="mt-4">
              <Link href="/settings/subscription" className={secondaryButtonClass}>
                {t("Back to the subscription")}
              </Link>
            </div>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-start gap-3">
        <CircleX aria-hidden className="size-8 shrink-0 text-red-600" />
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-white">{t("The payment did not go through")}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("Nothing was charged. Try again, or pay another way.")}</p>
          <div className="mt-4">{back}</div>
        </div>
      </div>
    </Card>
  );
}

export default function PaidPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  return (
    <>
      <PageTitle title="Payment" subtitle="HMIS subscription" />
      <Suspense fallback={<Skeleton className="h-40" />}>
        <Result searchParams={searchParams} />
      </Suspense>
    </>
  );
}

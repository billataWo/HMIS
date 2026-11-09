import { CircleCheck, Clock, CircleX } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonClass, Card, PageHeader, secondaryButtonClass, Skeleton } from "@/components/ui";
import { etb } from "@/lib/format";
import { checkPayment } from "../actions";

const back = (
  <Link href="/settings/subscription" className={buttonClass}>
    Back to the subscription
  </Link>
);

/**
 * Where Chapa and telebirr send the payer back to. HMIS asks the provider itself: what the address
 * bar says counts for nothing.
 */
async function Result({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const ref = (await searchParams).ref ?? "";
  const r = /^HMIS[0-9A-F]{6,40}$/.test(ref) ? await checkPayment(ref) : null;
  if (!r) {
    return (
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-300">This payment is not known here.</p>
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
            <h2 className="font-semibold text-slate-900 dark:text-white">Payment received: thank you</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {etb(r.amount)} by {via}
              {r.invoice && r.applied ? ` for invoice ${r.invoice.number}${r.invoice.status === "PAID" ? ", which is now paid" : ""}.` : "."}
              {!r.applied && " HMIS will apply it to your account and contact you if anything is needed."}
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
            <h2 className="font-semibold text-slate-900 dark:text-white">Waiting for {via} to confirm the payment…</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              This page updates by itself. If you left the payment page without paying, nothing was charged: go back and choose a way to pay.
            </p>
            <div className="mt-4">
              <Link href="/settings/subscription" className={secondaryButtonClass}>
                Back to the subscription
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
          <h2 className="font-semibold text-slate-900 dark:text-white">The payment did not go through</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Nothing was charged. Try again, or pay another way.</p>
          <div className="mt-4">{back}</div>
        </div>
      </div>
    </Card>
  );
}

export default function PaidPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  return (
    <>
      <PageHeader title="Payment" subtitle="HMIS subscription" />
      <Suspense fallback={<Skeleton className="h-40" />}>
        <Result searchParams={searchParams} />
      </Suspense>
    </>
  );
}

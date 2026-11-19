import Link from "next/link";

const TABS = [
  { href: "/platform/billing", label: "Invoices" },
  { href: "/platform/billing/payments", label: "Payments" },
] as const;

/** Invoices and payments: two views of the same money. */
export function BillingTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Billing" className="mb-5 flex gap-6 border-b border-slate-200 dark:border-slate-800">
      {TABS.map((t) => {
        const on = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-2.5 text-sm font-medium transition-colors ${
              on ? "border-brand-700 text-slate-900 dark:border-brand-400 dark:text-white" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

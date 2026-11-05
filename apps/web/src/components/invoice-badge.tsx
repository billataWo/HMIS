import { INVOICE_STATUS } from "@/lib/format";

export function InvoiceBadge({ status }: { status: string }) {
  const s = INVOICE_STATUS[status] ?? { label: status, className: "bg-zinc-100" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

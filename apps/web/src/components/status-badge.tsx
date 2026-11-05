import { VISIT_STATUS } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  const s = VISIT_STATUS[status] ?? { label: status, className: "bg-zinc-100" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

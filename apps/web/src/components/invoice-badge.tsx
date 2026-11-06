import { INVOICE_STATUS } from "@/lib/format";
import { Badge } from "./ui";

export function InvoiceBadge({ status }: { status: string }) {
  const s = INVOICE_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot>
      {status === "VOID" ? <s>{s.label}</s> : s.label}
    </Badge>
  );
}

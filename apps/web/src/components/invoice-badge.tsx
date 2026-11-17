"use client";

import { INVOICE_STATUS } from "@/lib/format";
import { useT } from "./lang-provider";
import { Badge } from "./ui";

export function InvoiceBadge({ status }: { status: string }) {
  const t = useT();
  const s = INVOICE_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot>
      {status === "VOID" ? <s>{t(s.label)}</s> : t(s.label)}
    </Badge>
  );
}

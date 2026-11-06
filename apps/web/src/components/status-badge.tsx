import { VISIT_STATUS } from "@/lib/format";
import { type Lang, tr } from "@/lib/i18n";
import { Badge } from "./ui";

export function StatusBadge({ status, lang = "en" }: { status: string; lang?: Lang }) {
  const s = VISIT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot>
      {status === "CANCELLED" ? <s>{tr(lang, s.label)}</s> : tr(lang, s.label)}
    </Badge>
  );
}

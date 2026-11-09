import { Badge, type BadgeTone } from "@/components/ui";
import type { SubscriptionState } from "@/lib/api";
import { CLINIC_TZ } from "@/lib/format";

const STATE: Record<SubscriptionState, { label: string; tone: BadgeTone }> = {
  trial: { label: "Trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  overdue: { label: "Overdue", tone: "warning" },
  suspended: { label: "Suspended", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function StateBadge({ state }: { state: SubscriptionState }) {
  const s = STATE[state];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: CLINIC_TZ }) : "—";

export const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: CLINIC_TZ });

export const thClass = "px-3 py-2 text-left text-xs font-medium tracking-wide text-slate-500 uppercase";
export const tdClass = "px-3 py-2.5 align-top";

import type { BadgeTone } from "@/components/ui";
import type { PurchaseOrderStatus } from "@/lib/api";

export const PO_STATUS: Record<PurchaseOrderStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ORDERED: { label: "Ordered", tone: "info" },
  PARTLY_RECEIVED: { label: "Partly received", tone: "warning" },
  RECEIVED: { label: "Received", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

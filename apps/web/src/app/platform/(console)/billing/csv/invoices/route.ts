import { type InvoiceLedger, platformApi } from "@/lib/platform";
import { csvDate, csvResponse, today } from "../../../../csv";

/** Every invoice that matches the page's filters, for the accountant. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = new URLSearchParams([...params].filter(([k, v]) => ["status", "q"].includes(k) && v));
  const { invoices } = await platformApi<InvoiceLedger>(`/platform/invoices${q.size ? `?${q}` : ""}`);
  return csvResponse(
    `hmis-invoices-${today()}.csv`,
    ["Number", "Clinic", "Plan", "Cycle", "Period start", "Period end", "Issued", "Due", "Subtotal", "VAT", "Total", "Paid", "Balance", "Status", "Days late", "Paid on", "Void reason"],
    invoices.map((i) => [
      i.number,
      i.clinic,
      i.planName,
      i.cycle.toLowerCase(),
      csvDate(i.periodStart),
      csvDate(i.periodEnd),
      csvDate(i.issuedAt),
      csvDate(i.dueDate),
      i.subtotal,
      i.vat,
      i.total,
      i.paid,
      i.balance,
      i.status.toLowerCase(),
      i.daysLate || "",
      csvDate(i.paidAt),
      i.voidReason ?? "",
    ]),
  );
}

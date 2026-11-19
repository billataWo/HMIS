import { METHOD_LABEL, type PaymentLedger, platformApi } from "@/lib/platform";
import { csvDate, csvResponse, today } from "../../../../csv";

/** Every payment that matches the page's filters: for reconciling with the bank statement. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = new URLSearchParams([...params].filter(([k, v]) => ["status", "method", "from", "to", "q"].includes(k) && v));
  const { payments } = await platformApi<PaymentLedger>(`/platform/payments${q.size ? `?${q}` : ""}`);
  return csvResponse(
    `hmis-payments-${today()}.csv`,
    ["Paid on", "Clinic", "Invoice", "Amount", "Method", "Reference", "Status", "Checked by", "Reason"],
    payments.map((p) => [
      csvDate(p.paidAt),
      p.clinic,
      p.invoice.number,
      p.amount,
      METHOD_LABEL[p.method] ?? p.method,
      p.reference ?? "",
      p.status.toLowerCase(),
      p.reviewedBy ?? "",
      p.rejectReason ?? "",
    ]),
  );
}

import { platformApi, type SalesReport } from "@/lib/platform";
import { csvResponse } from "../../../../csv";

/** Invoiced and collected, month by month, for one year. */
export async function GET(request: Request) {
  const year = new URL(request.url).searchParams.get("year") ?? "";
  const r = await platformApi<SalesReport>(`/platform/reports/sales${/^\d{4}$/.test(year) ? `?year=${year}` : ""}`);
  return csvResponse(
    `hmis-sales-${r.year}.csv`,
    ["Month", "Invoices", "Voided", "Before VAT", "VAT", "Invoiced", "Collected"],
    [
      ...r.months.map((m) => [m.month, m.invoices, m.voided, m.subtotal, m.vat, m.total, m.collected]),
      [String(r.year), r.totals.invoices, r.totals.voided, r.totals.subtotal, r.totals.vat, r.totals.total, r.totals.collected],
    ],
  );
}

import { platformApi, type VatRegister } from "@/lib/platform";
import { csvDate, csvResponse } from "../../../../csv";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The VAT sales register: every invoice issued in the period, with the buyer's TIN. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = new URLSearchParams([...params].filter(([k, v]) => ["from", "to"].includes(k) && DAY.test(v)));
  const r = await platformApi<VatRegister>(`/platform/reports/vat-register${q.size ? `?${q}` : ""}`);
  return csvResponse(
    `hmis-vat-register-${r.period.from}-to-${r.period.to}.csv`,
    ["Issued", "Invoice", "Clinic", "Clinic TIN", "Plan", "Before VAT", "VAT", "Total", "Status", "Void reason"],
    r.invoices.map((i) => {
      const off = i.status === "VOID";
      return [csvDate(i.issuedAt), i.number, i.clinic, i.tin ?? "", i.planName, off ? "0.00" : i.subtotal, off ? "0.00" : i.vat, off ? "0.00" : i.total, i.status.toLowerCase(), i.voidReason ?? ""];
    }),
  );
}

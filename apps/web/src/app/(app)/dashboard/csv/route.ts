import { csvResponse } from "@/app/platform/csv";
import { api, ApiError, type Dashboard } from "@/lib/api";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The dashboard's numbers as a CSV file: the period against the one before, then day by day,
 * payments by method, services by department, top diagnoses and patients by doctor. English, like
 * the MoH file; the API decides who may have it (admins).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (k: string) => {
    const v = url.searchParams.get(k);
    return v && DAY.test(v) ? v : null;
  };
  const from = q("from");
  const to = q("to") ?? from;
  let d: Dashboard;
  try {
    d = await api<Dashboard>(`/reports/dashboard${from ? `?from=${from}&to=${to}` : ""}`);
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) return new Response(e.message, { status: e.status });
    throw e;
  }
  const p = d.previous;

  const rows: (string | number | null)[][] = [
    ["Period", d.from, d.to, "Previous period", p?.from ?? null, p?.to ?? null],
    [],
    ["Measure", "This period", "Previous period"],
    ["Patient visits", d.patients.visits, p?.visits ?? null],
    ["Visits completed", d.patients.completed, p?.completed ?? null],
    ["New patients registered", d.patients.newPatients, p?.newPatients ?? null],
    ["Average wait to see a doctor (min)", d.patients.avgWaitMinutes, p?.avgWaitMinutes ?? null],
    ["Median wait (min)", d.patients.medianWaitMinutes ?? null, null],
    ["90% seen within (min)", d.patients.p90WaitMinutes ?? null, null],
    ["Visits cancelled", d.patients.cancelled ?? 0, null],
    ["Left without being seen", d.patients.cancelledByReason?.LEFT_WITHOUT_BEING_SEEN ?? 0, null],
    ["Cash collected (ETB)", d.revenue.collected, p?.collected ?? null],
    ["Billed (ETB)", d.revenue.billed, p?.billed ?? null],
    ["Discounts (ETB)", d.revenue.discounts, null],
    ["Delivered but not billed (ETB)", d.revenue.unbilled, p?.unbilled ?? null],
    ["Patients still owe, all time (ETB)", d.revenue.patientsOwe, null],
    ["Lab tests ordered", d.lab.ordered, null],
    ["Lab results verified", d.lab.verified, null],
    ["Pharmacy sales (ETB)", d.pharmacy.sales, null],
    ["Stock value on shelf, cost (ETB)", d.stock.value, null],
    [],
    ["Day", "Visits", "New patients", "Average wait (min)", "Billed (ETB)", "Collected (ETB)"],
    ...d.daily.map((x) => [x.day, x.visits, x.newPatients ?? null, x.avgWaitMinutes ?? null, x.billed ?? null, x.collected]),
    [],
    ["Payment method", "Amount (ETB)"],
    ...Object.entries(d.revenue.byMethod).map(([m, v]) => [m, v ?? null]),
    [],
    ["Department", "Services delivered (ETB)"],
    ...(d.revenue.bySource ?? []).map((x) => [x.source, x.amount]),
    [],
    ["ICD-11", "Diagnosis", "Visits"],
    ...d.topDiagnoses.map((x) => [x.code, x.label, x.count]),
    [],
    ["Doctor", "Patients seen"],
    ...d.patients.byDoctor.map((x) => [x.name, x.count]),
  ];
  const [header, ...body] = rows;
  return csvResponse(`dashboard-${d.from}-to-${d.to}.csv`, header.map((v) => (v === null ? "" : String(v))), body);
}

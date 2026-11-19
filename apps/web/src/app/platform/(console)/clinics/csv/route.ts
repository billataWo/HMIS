import { type ClinicRow, DEPLOYMENT_LABEL, platformApi } from "@/lib/platform";
import { csvDate, csvResponse, today } from "../../../csv";

/** Every clinic, with its plan, standing and use. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  const clinics = await platformApi<ClinicRow[]>(`/platform/clinics${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return csvResponse(
    `hmis-clinics-${today()}.csv`,
    ["Clinic", "Name (Amharic)", "Type", "Joined", "Plan", "Billed", "Runs on", "Status", "Until", "Monthly revenue", "Active staff", "Staff limit", "Patients", "Visits (30 days)", "Last activity"],
    clinics.map((c) => [
      c.name,
      c.nameAm ?? "",
      c.type.toLowerCase(),
      csvDate(c.createdAt),
      c.subscription?.plan.name ?? "not billed",
      c.subscription?.billingCycle.toLowerCase() ?? "",
      c.subscription ? DEPLOYMENT_LABEL[c.subscription.deployment] : "",
      c.subscription?.state ?? "",
      csvDate(c.subscription?.endsAt),
      c.mrr,
      c.staff,
      c.subscription?.plan.maxStaff ?? "",
      c.patients,
      c.visits30,
      csvDate(c.lastActivityAt),
    ]),
  );
}

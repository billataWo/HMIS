import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, TOKEN_COOKIE } from "@/lib/api";

/**
 * One patient's whole record as a JSON file (admins; the right of access and data portability).
 * The API checks the role and records the export in the audit log.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.redirect(new URL("/login", request.url));
  const res = await fetch(`${API_URL}/exports/patients/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401) return NextResponse.redirect(new URL("/login", request.url));
  if (!res.ok) return new NextResponse(res.status === 403 ? "Only clinic admins can export a patient's record." : "This record could not be exported.", { status: res.status });
  const record = (await res.json()) as { patient: { mrn: string } };
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(record, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="patient-${record.patient.mrn.replace(/[^A-Za-z0-9-]/g, "")}-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

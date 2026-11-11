import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, TOKEN_COOKIE } from "@/lib/api";
import { fromThisSite } from "@/lib/same-site";

const back = (request: Request, error: string) => NextResponse.redirect(new URL(`/settings/data?error=${error}`, request.url), 303);

/**
 * Downloading the whole clinic's data, in two steps:
 *  - POST (the form on Settings → Your data, with the admin's password): a one-time ticket from the
 *    API, then on to step 2;
 *  - GET ?ticket=…: the file, streamed from the API as it is produced (it can be large).
 * A plain GET download is what browsers handle reliably; the password stays out of the URL.
 */
export async function POST(request: Request) {
  if (!fromThisSite(request)) return new NextResponse("Not allowed from another site", { status: 403 });
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.redirect(new URL("/login", request.url), 303);
  const form = await request.formData();
  const res = await fetch(`${API_URL}/exports/clinic/ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: String(form.get("password") ?? "") }),
    cache: "no-store",
  });
  if (res.status === 401) return back(request, "password");
  if (res.status === 429) return back(request, "locked");
  if (!res.ok) return back(request, "failed");
  const { ticket } = (await res.json()) as { ticket: string };
  return NextResponse.redirect(new URL(`/settings/data/download?ticket=${encodeURIComponent(ticket)}`, request.url), 303);
}

export async function GET(request: Request) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.redirect(new URL("/login", request.url));
  const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
  const res = await fetch(`${API_URL}/exports/clinic?ticket=${encodeURIComponent(ticket)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok || !res.body) return back(request, res.status === 401 ? "expired" : "failed");
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": res.headers.get("content-disposition") ?? 'attachment; filename="hmis-clinic-export.ndjson.gz"',
      "Cache-Control": "no-store",
    },
  });
}

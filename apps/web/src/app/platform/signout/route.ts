import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PLATFORM_CHALLENGE_COOKIE, PLATFORM_COOKIE } from "@/lib/platform";

/** Ends the operator's session in this browser (also used when the API says it has ended). */
export async function GET(request: Request) {
  const store = await cookies();
  store.delete({ name: PLATFORM_COOKIE, path: "/platform" });
  store.delete({ name: PLATFORM_CHALLENGE_COOKIE, path: "/platform" });
  return NextResponse.redirect(new URL("/platform/login", request.url));
}

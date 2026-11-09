import { NextResponse, type NextRequest } from "next/server";

/** The platform console's sign-in (HMIS staff), separate from the clinics' "hmis_token". */
const PLATFORM_COOKIE = "hmis_platform";

// Optimistic check only: the API verifies the token on every request.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  // The waiting-room screen uses its own display key; the request page is public.
  if (under("/display") || under("/request")) return NextResponse.next();

  // The platform console (HMIS staff) has its own sign-in.
  if (under("/platform")) {
    const signedIn = request.cookies.has(PLATFORM_COOKIE);
    const onLogin = under("/platform/login");
    if (!signedIn && !onLogin) return NextResponse.redirect(new URL("/platform/login", request.url));
    if (signedIn && onLogin) return NextResponse.redirect(new URL("/platform", request.url));
    return NextResponse.next();
  }

  const hasToken = request.cookies.has("hmis_token");
  // The sign-in pages (password, then the two-step code) work without a session.
  const onLogin = under("/login");
  if (!hasToken && !onLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (hasToken && onLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  // The service worker and manifest must load without a sign-in (the browser fetches them itself).
  matcher: ["/((?!_next/|favicon.ico|sw.js|manifest.webmanifest).*)"],
};

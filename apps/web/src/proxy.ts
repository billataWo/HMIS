import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: the API verifies the token on every request.
export function proxy(request: NextRequest) {
  const hasToken = request.cookies.has("hmis_token");
  const path = request.nextUrl.pathname;
  // The sign-in pages (password, then the two-step code) work without a session.
  const onLogin = path === "/login" || path.startsWith("/login/");
  // The waiting-room screen uses its own display key, never a staff sign-in.
  if (path === "/display" || path.startsWith("/display/")) return NextResponse.next();
  if (!hasToken && !onLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (hasToken && onLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  // The service worker and manifest must load without a sign-in (the browser fetches them itself).
  matcher: ["/((?!_next/|favicon.ico|sw.js|manifest.webmanifest).*)"],
};

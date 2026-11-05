import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: the API verifies the token on every request.
export function proxy(request: NextRequest) {
  const hasToken = request.cookies.has("hmis_token");
  const onLogin = request.nextUrl.pathname === "/login";
  if (!hasToken && !onLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (hasToken && onLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};

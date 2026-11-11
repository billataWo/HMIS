import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PAGES } from "./lib/site-lang";
import { STAFF_BROWSER_COOKIE } from "./lib/staff-browser";

/** The platform console's sign-in (HMIS staff), separate from the clinics' "hmis_token". */
const PLATFORM_COOKIE = "hmis_platform";
/** The language chosen (lib/i18n.ts LANG_COOKIE; not imported, to keep the dictionary out of the proxy). */
const LANG_COOKIE = "hmis_lang";

// Optimistic check only: the API verifies the token on every request.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  // The public site, in English and in Amharic (/am/…). Someone who chose Amharic gets the Amharic
  // page when they open the English address (a shared link, the sign-in page's links).
  if ((PUBLIC_PAGES as readonly string[]).includes(path) && request.cookies.get(LANG_COOKIE)?.value === "am") {
    const url = request.nextUrl.clone();
    url.pathname = `/am${path}`;
    return NextResponse.redirect(url);
  }
  // The waiting-room screen uses its own display key; the request page and the legal pages are public.
  if (under("/display") || under("/am") || PUBLIC_PAGES.some((p) => under(p))) return NextResponse.next();
  // Answered by the API with its own tokens and signatures (lib/pass-through.ts).
  if (under("/sync") || under("/public/payments")) return NextResponse.next();

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
  // On the HMIS cloud, visitors who are not signed in arrive at the front page for new clinics
  // (it links to the sign-in). Browsers that clinic staff sign in on go to the sign-in.
  const newVisitor = !hasToken && !request.cookies.has(STAFF_BROWSER_COOKIE);
  if (newVisitor && path === "/" && process.env.HMIS_PLATFORM === "1") {
    return NextResponse.redirect(new URL(request.cookies.get(LANG_COOKIE)?.value === "am" ? "/am/welcome" : "/welcome", request.url));
  }
  if (!hasToken && !onLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (hasToken && onLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  // The service worker and manifest must load without a sign-in (the browser fetches them itself).
  matcher: ["/((?!_next/|favicon.ico|sw.js|manifest.webmanifest).*)"],
};

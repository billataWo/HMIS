/**
 * Set when someone signs in to a clinic on this browser, and kept for a year. On the HMIS cloud, a
 * signed-out visit to "/" goes to the front page for new clinics, except on browsers that clinic
 * staff use: those go straight to the sign-in. It says nothing about who signed in.
 */
export const STAFF_BROWSER_COOKIE = "hmis_staff_browser";
export const STAFF_BROWSER_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", maxAge: 365 * 24 * 60 * 60, path: "/" } as const;

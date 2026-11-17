import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, type Lang, type T } from "./i18n";

/** The signed-in browser's interface language (per device, chosen in the sidebar). */
export async function getLang(): Promise<Lang> {
  return (await cookies()).get(LANG_COOKIE)?.value === "am" ? "am" : "en";
}

/** The translator for this request's language (server components and server actions). */
export async function getT(): Promise<T> {
  return makeT(await getLang());
}

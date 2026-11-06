import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, type Lang } from "./i18n";

/** The signed-in browser's interface language (per device, chosen in the sidebar). */
export async function getLang(): Promise<Lang> {
  return (await cookies()).get(LANG_COOKIE)?.value === "am" ? "am" : "en";
}

import Link from "next/link";
import { secondaryButtonClass } from "@/components/ui";
import { getT } from "@/lib/lang";

/** The "Settings" button in the header of each settings page. */
export async function BackToSettings() {
  const t = await getT();
  return (
    <Link href="/settings" className={secondaryButtonClass}>
      {t("Settings")}
    </Link>
  );
}
